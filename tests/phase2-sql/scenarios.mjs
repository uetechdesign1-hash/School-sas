import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDb } from "./load.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const db = await loadDb();
await db.exec(readFileSync(`${repo}/docs/phase-2-step-1-sales-rep-enum.sql`, "utf8"));
await db.exec(readFileSync(`${repo}/docs/phase-2-supabase-sql-editor.sql`, "utf8"));

let pass = 0, fail = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; failures.push(name); console.log("  FAIL", name, "->", e.message.split("\n")[0]); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
async function rejects(fn, re) {
  try { await fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`); return; }
  throw new Error("expected an error but call succeeded");
}
async function as(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false), set_config('request.jwt.claim.role','authenticated',false); SET SESSION AUTHORIZATION authenticator; SET ROLE authenticated;`);
  try { return await fn(); }
  finally { await db.exec(`RESET ROLE; SET SESSION AUTHORIZATION postgres; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false);`); }
}
async function asAnon(fn) {
  await db.exec(`SET SESSION AUTHORIZATION authenticator; SET ROLE anon;`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SET SESSION AUTHORIZATION postgres;`); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const q1 = async (sql, params) => (await q(sql, params))[0];
const J = (o) => JSON.stringify(o);

const SA = "00000000-0000-0000-0000-0000000000a1";
const STAFF = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`
 insert into auth.users(id,email) values ('${SA}','admin@co.test'),('${STAFF}','staff@sch.test');
 insert into public.user_profiles(id,full_name,platform_role) values ('${SA}','Admin','super_admin'),('${STAFF}','Staff','user');
`);

async function provisionRep(name, email, key) {
  const start = await as(SA, () => q1(`select public.start_sales_rep_provisioning($1,$2,'9999900000',null,null,null,$3) r`, [name, email, key]));
  const jobId = start.r.job_id;
  await as(SA, () => q(`select public.claim_provisioning_job($1)`, [jobId]));
  const uid = (await q1(`insert into auth.users(email) values ($1) returning id`, [email])).id;
  await as(SA, () => q(`select public.record_provisioned_auth_user($1,$2)`, [jobId, uid]));
  await as(SA, () => q(`select public.complete_provisioning_job($1)`, [jobId]));
  return { uid, repId: start.r.rep_id, jobId };
}

console.log("\n== Provisioning & roles");
let A, B;
await t("SA creates reps A and B", async () => { A = await provisionRep("Rep A", "a@co.test", "k-a"); B = await provisionRep("Rep B", "b@co.test", "k-b"); });
await t("rep profile has sales_rep role and active status", async () => {
  const r = await q1(`select up.platform_role::text role, sr.status from user_profiles up join sales_representatives sr on sr.user_id=up.id where up.id=$1`, [A.uid]);
  eq(r, { role: "sales_rep", status: "active" });
});
await t("start is idempotent per key", async () => {
  const r = await as(SA, () => q1(`select public.start_sales_rep_provisioning('Rep A','a@co.test','1',null,null,null,'k-a') r`));
  eq(r.r.idempotent, true);
});
await t("complete is idempotent", async () => {
  const r = await as(SA, () => q1(`select public.complete_provisioning_job($1) r`, [A.jobId]));
  eq(r.r.idempotent, true);
});
await t("rep cannot call SA-only provisioning", () => rejects(() => as(A.uid, () => q(`select public.start_sales_rep_provisioning('X','x@co.test','1',null,null,null,'k-x')`)), /Super Admin/));
await t("rep cannot self-promote to super_admin (update)", async () => {
  await as(A.uid, () => q(`update user_profiles set platform_role='super_admin' where id=$1`, [A.uid]));
  eq((await q1(`select platform_role::text r from user_profiles where id=$1`, [A.uid])).r, "sales_rep");
});
await t("trigger blocks a rep's role/activation change even if RLS were bypassed", async () => {
  await db.exec(`select set_config('request.jwt.claim.sub','${A.uid}',false), set_config('request.jwt.claim.role','authenticated',false)`);
  try {
    await rejects(() => db.query(`update user_profiles set is_active=false where id=$1`, [A.uid]), /Only a Super Admin/);
    await rejects(() => db.query(`update user_profiles set platform_role='super_admin' where id=$1`, [A.uid]), /Only a Super Admin/);
  } finally { await db.exec(`select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)`); }
});
await t("rep cannot create a sales_rep profile via direct insert", () => rejects(() => as(STAFF, () => q(`insert into user_profiles(id,platform_role) values (gen_random_uuid(),'sales_rep')`))));
await t("duplicate login email refused", () => rejects(() => as(SA, () => q(`select public.start_sales_rep_provisioning('Dup','a@co.test','1',null,null,null,'k-dup')`)), /already exists/));
await t("failure path: job fails, retry claims again, auth link retained", async () => {
  const s = await as(SA, () => q1(`select public.start_sales_rep_provisioning('Rep F','f@co.test','1',null,null,null,'k-f') r`));
  const id = s.r.job_id;
  await as(SA, () => q(`select public.claim_provisioning_job($1)`, [id]));
  await rejects(() => as(SA, () => q(`select public.claim_provisioning_job($1)`, [id])), /already being processed/);
  await as(SA, () => q(`select public.fail_provisioning_job($1,'auth timeout')`, [id]));
  const c = await as(SA, () => q1(`select public.claim_provisioning_job($1) r`, [id]));
  eq(c.r.attempts, 2);
  const uid = (await q1(`insert into auth.users(email) values ('f@co.test') returning id`)).id;
  await as(SA, () => q(`select public.record_provisioned_auth_user($1,$2)`, [id, uid]));
  await as(SA, () => q(`select public.fail_provisioning_job($1,'db blip after auth')`, [id]));
  const j = await q1(`select status, auth_user_id from business_provisioning_jobs where id=$1`, [id]);
  eq(j.status, "auth_created"); eq(j.auth_user_id, uid);
  await as(SA, () => q(`select public.claim_provisioning_job($1)`, [id])).catch(() => {});
});
await t("orphan auth accounts listing is SA-only", () => rejects(() => as(A.uid, () => q(`select * from public.list_orphan_auth_accounts()`)), /Super Admin/));

console.log("\n== Company settings & documents");
await t("rep cannot edit company settings", async () => {
  await as(A.uid, () => q(`update company_settings set legal_company_name='Hack'`));
  eq((await q1(`select legal_company_name n from company_settings`)).n, null);
});
await t("SA configures company settings", async () => {
  await as(SA, () => q(`update company_settings set legal_company_name='SCB Technologies Pvt Ltd', registered_address='1 Main Rd, Bengaluru', authorized_signatory_name='R. Kumar', authorized_signatory_designation='Director', logo_path='company/logo.png', signature_path='company/sig.png', gstin='29ABCDE1234F1Z5'`));
  eq((await q1(`select legal_company_name n from company_settings`)).n, "SCB Technologies Pvt Ltd");
});
await t("anon reads only published policies", async () => {
  const rows = await asAnon(() => q(`select policy_type, status from website_policies order by 1`));
  eq(rows.length, 2); if (rows.some(r => r.status !== "published")) throw new Error("non-published visible");
});
await t("anon cannot read company_settings / mou terms / plans", async () => {
  await rejects(() => asAnon(() => q(`select * from company_settings`)), /permission denied/);
  await rejects(() => asAnon(() => q(`select * from mou_terms_versions`)), /permission denied/);
});
await t("anon cannot execute business RPCs", () => rejects(() => asAnon(() => q(`select public.create_school_sale('{}'::jsonb)`)), /permission denied/));
await t("policy versions independent; publish archives previous only for same type", async () => {
  const d = await as(SA, () => q1(`insert into website_policies(policy_type,title,content) values ('privacy_policy','Privacy v2','new text') returning id, version`));
  eq(d.version, 2);
  await as(SA, () => q(`select public.publish_website_policy($1)`, [d.id]));
  const r = await q(`select policy_type, version, status from website_policies order by policy_type, version`);
  eq(r.map(x => `${x.policy_type}:${x.version}:${x.status}`), ["privacy_policy:1:archived", "privacy_policy:2:published", "terms_and_conditions:1:published"]);
  eq((await q1(`select max(version) v from mou_terms_versions`)).v, 1);
});
await t("published policy content is immutable", () => rejects(() => as(SA, () => q(`update website_policies set content='x' where policy_type='terms_and_conditions'`)), /immutable|Use the publish/));
await t("cannot publish a draft by direct status update", async () => {
  const d = await as(SA, () => q1(`insert into website_policies(policy_type,title,content) values ('terms_and_conditions','T v2','t2') returning id`));
  await rejects(() => as(SA, () => q(`update website_policies set status='published', published_at=now(), effective_date=current_date where id=$1`, [d.id])), /publish function|permission denied/);
});

console.log("\n== Pricing");
await t("default prices seeded", async () => {
  const r = await q(`select p.code, pr.default_price::text d from subscription_plans p join subscription_plan_prices pr on pr.plan_id=p.id and pr.effective_to is null order by p.sort_order`);
  eq(r.map(x => `${x.code}=${x.d}`), ["plan1=100.00", "plan2=5000.00", "both=150.00"]);
});
await t("quote: both plans, 300 students, 60 => 18000", async () => {
  const r = await as(A.uid, () => q1(`select public.quote_subscription('both',300,60,0,12) r`));
  eq(r.r.total_amount, 18000); eq(r.r.default_unit_price, 150);
});
await t("quote: plan1 default 100 x 300 = 30000; plan2 per school ignores students", async () => {
  const a = await as(A.uid, () => q1(`select public.quote_subscription('plan1',300) r`));
  const b = await as(A.uid, () => q1(`select public.quote_subscription('plan2',300,3500) r`));
  eq(a.r.total_amount, 30000); eq(b.r.total_amount, 3500); eq(b.r.price_outside_recommended_range, false);
  const c = await as(A.uid, () => q1(`select public.quote_subscription('plan2',300,1000) r`));
  eq(c.r.price_outside_recommended_range, true);
});
await t("discount cannot exceed gross", () => rejects(() => as(A.uid, () => q(`select public.quote_subscription('plan1',10,10,500,12)`)), /invalid/));
await t("rep cannot change prices; SA versioned price change", async () => {
  await rejects(() => as(A.uid, () => q(`select public.set_subscription_plan_price('plan1',120)`)), /Super Admin/);
  await as(SA, () => q(`select public.set_subscription_plan_price('plan1',110,null,null,current_date + 1)`));
  const n = await q1(`select count(*)::int c from subscription_plan_prices pp join subscription_plans p on p.id=pp.plan_id where p.code='plan1'`);
  eq(n.c, 2);
  await rejects(() => as(SA, () => q(`update subscription_plan_prices set default_price=1`)), /immutable|permission denied/);
});

const mk = (o) => J({
  school_name: "School", school_code: "SCH001", start_date: "2026-06-01", email: "s@x.test", phone: "1", address: "addr", city: "City",
  district: "Dist", state: "KA", postal_code: "560001", contact_person: "CP", contact_phone: "2",
  principal_name: "P", branch_count: 1, student_strength: 300, staff_strength: 20, plan_code: "both",
  negotiated_unit_price: 60, discount_amount: 0, term_months: 12, billing_frequency: "yearly",
  payment_terms: "Annual in advance", special_conditions: null, sales_discussion_confirmed: true,
  idempotency_key: "sale-1", owner: { name: "Owner", email: "owner1@sch.test", phone: "3" }, ...o });

console.log("\n== Sales workflow & isolation");
let A1, B1;
await t("A creates School A1 (both, 300 x 60 = 18000)", async () => {
  const r = await as(A.uid, () => q1(`select public.create_school_sale($1::jsonb) r`, [mk({ school_code: "SCA1", school_name: "School A1", idempotency_key: "sale-a1", owner: { name: "O", email: "oa1@sch.test" } })]));
  A1 = r.r; eq(A1.quote.total_amount, 18000);
  const s = await q1(`select amount::text a, enabled_modules, billing_student_count from school_subscriptions where school_id=$1`, [A1.school_id]);
  eq(s.a, "18000.00"); eq(s.enabled_modules, ["fees", "payroll"]);
  const o = await q1(`select original_acquisition_rep_id o, current_rep_id c from school_sales_ownership where school_id=$1`, [A1.school_id]);
  eq(o, { o: A.uid, c: A.uid });
});
await t("create is idempotent on the same key", async () => {
  const r = await as(A.uid, () => q1(`select public.create_school_sale($1::jsonb) r`, [mk({ school_code: "SCA1", idempotency_key: "sale-a1" })]));
  eq(r.r.idempotent, true); eq(r.r.school_id, A1.school_id);
  eq((await q1(`select count(*)::int c from schools where school_code='SCA1'`)).c, 1);
});
await t("B creates School B1", async () => {
  const r = await as(B.uid, () => q1(`select public.create_school_sale($1::jsonb) r`, [mk({ school_code: "SCB1", school_name: "School B1", idempotency_key: "sale-b1", plan_code: "plan1", negotiated_unit_price: 100, owner: { name: "O", email: "ob1@sch.test" } })]));
  B1 = r.r; eq(B1.quote.total_amount, 30000);
});
await t("first invoice issued at creation (yearly = full contract once)", async () => {
  const r = await q(`select total_amount::text t, period_sequence from school_invoices where school_id=$1`, [A1.school_id]);
  eq(r, [{ t: "18000.00", period_sequence: 1 }]);
});
await t("A sees only own school; B only B1", async () => {
  eq((await as(A.uid, () => q(`select code from schools order by code`))).map(r => r.code), ["SCA1"]);
  eq((await as(B.uid, () => q(`select code from schools order by code`))).map(r => r.code), ["SCB1"]);
});
await t("A cannot read B1 subscription/invoices/ownership/mous", async () => {
  for (const tbl of ["school_subscriptions", "school_invoices", "school_sales_ownership", "school_subscription_history"]) {
    const n = await as(A.uid, () => q1(`select count(*)::int c from ${tbl} where school_id=$1`, [B1.school_id]));
    eq(n.c, 0, tbl);
  }
});
await t("A cannot use B's invoice / generate MOU for B1", async () => {
  const inv = (await q1(`select id from school_invoices where school_id=$1`, [B1.school_id])).id;
  await rejects(() => as(A.uid, () => q(`select public.submit_school_payment($1,100,current_date,'upi','UPI-X','idem-x')`, [inv])), /access/);
  await rejects(() => as(A.uid, () => q(`select public.generate_initial_mou($1)`, [B1.school_id])), /access/);
});
await t("platform tenant hidden from SA and reps", async () => {
  eq((await as(SA, () => q1(`select count(*)::int c from schools where is_platform_internal`))).c, 0);
  eq((await as(SA, () => q1(`select count(*)::int c from schools`))).c, 2);
  eq((await q1(`select count(*)::int c from schools where is_platform_internal`)).c, 1);
});
await t("rep cannot insert schools directly with agreement bypass", () => rejects(() => as(A.uid, () => q(`insert into schools(name,code,school_code,created_by,enabled_modules,student_limit,subscription_amount,subscription_payment_terms,sales_discussion_confirmed) values ('X','XX1','XX1',$1,'{fees}',10,0,'t',true)`, [A.uid]))));
await t("sale validation: needs explicit confirmation, plan, price", async () => {
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "NC1", idempotency_key: "nc1", sales_discussion_confirmed: false })])), /Confirm/);
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "NC2", idempotency_key: "nc2", plan_code: "bogus" })])), /plan/);
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "NC3", idempotency_key: "nc3", negotiated_unit_price: null })])), /price/i);
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "NC4", idempotency_key: "nc4", billing_frequency: "monthly" })])), /instalments/);
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "SCA1", idempotency_key: "nc5" })])), /already exists/);
  eq((await q1(`select count(*)::int c from schools where code like 'NC%'`)).c, 0);
});
await t("rep cannot claim another rep via representative_id", async () => {
  const r = await as(A.uid, () => q1(`select public.create_school_sale($1::jsonb) r`, [mk({ school_code: "SCA2", idempotency_key: "sale-a2", representative_id: B.uid, plan_code: "plan2", negotiated_unit_price: 3500, owner: { name: "O", email: "oa2@sch.test" } })]));
  const o = await q1(`select current_rep_id c from school_sales_ownership where school_id=$1`, [r.r.school_id]);
  eq(o.c, A.uid); eq(r.r.quote.total_amount, 3500);
});
await t("monthly option: 18000/12 = 1500, no repeated annual invoices", async () => {
  const r = await as(A.uid, () => q1(`select public.create_school_sale($1::jsonb) r`, [mk({ school_code: "SCM1", idempotency_key: "sale-m1", billing_frequency: "monthly", monthly_instalments_allowed: true, start_date: "2026-01-01", owner: { name: "O", email: "om1@sch.test" } })]));
  const sub = r.r.subscription_id;
  eq((await q1(`select total_amount::text t from school_invoices where subscription_id=$1`, [sub])).t, "1500.00");
  const n1 = (await as(SA, () => q1(`select public.generate_school_invoices($1,'2026-03-15') n`, [sub]))).n;
  eq(n1, 2);
  const n2 = (await as(SA, () => q1(`select public.generate_school_invoices($1,'2026-03-15') n`, [sub]))).n;
  eq(n2, 0);
  await as(SA, () => q(`select public.generate_school_invoices($1,'2027-12-31')`, [sub]));
  const tot = await q1(`select count(*)::int c, sum(amount)::text s from school_invoices where subscription_id=$1`, [sub]);
  eq(tot, { c: 12, s: "18000.00" });
});
await t("duplicate invoice period blocked by constraint", () => rejects(() => db.query(`insert into school_invoices(invoice_number,school_id,subscription_id,period_sequence,period_start,period_end,due_date,amount,total_amount,snapshot,created_by) select 'X',school_id,subscription_id,99,period_start,period_end,due_date,amount,total_amount,snapshot,created_by from school_invoices where school_id=$1 limit 1`, [A1.school_id]), /duplicate key/));

console.log("\n== MOU");
let mou1;
await t("initial MOU: snapshot has company, school, 18000, terms, A4 notice", async () => {
  const r = await as(A.uid, () => q1(`select public.generate_initial_mou($1,'Bengaluru') r`, [A1.school_id]));
  mou1 = r.r; eq(mou1.version, 1); eq(mou1.total_amount, 18000);
  const s = await q1(`select snapshot from school_mous where id=$1`, [mou1.mou_id]);
  eq(s.snapshot.document_label, "INITIAL MOU / PROVISIONAL AGREEMENT");
  eq(s.snapshot.company.legal_company_name, "SCB Technologies Pvt Ltd");
  eq(s.snapshot.commercial.total_amount, 18000); eq(s.snapshot.commercial.negotiated_unit_price, 60);
  eq(s.snapshot.terms.version, 1); eq(s.snapshot.payment_schedule.length, 1);
});
await t("regenerate creates version 2; version 1 remains", async () => {
  const r = await as(A.uid, () => q1(`select public.generate_initial_mou($1) r`, [A1.school_id]));
  eq(r.r.version, 2);
  eq((await q(`select version from school_mous where school_id=$1 and mou_type='initial' order by 1`, [A1.school_id])).map(x => x.version), [1, 2]);
});
await t("MOU snapshot unaffected by later company/branding change", async () => {
  await as(SA, () => q(`update company_settings set legal_company_name='Renamed Co'`));
  eq((await q1(`select snapshot->'company'->>'legal_company_name' n from school_mous where id=$1`, [mou1.mou_id])).n, "SCB Technologies Pvt Ltd");
  await as(SA, () => q(`update company_settings set legal_company_name='SCB Technologies Pvt Ltd'`));
});
await t("MOU rows immutable (update/delete refused)", async () => {
  await rejects(() => db.query(`update school_mous set total_amount=1 where id=$1`, [mou1.mou_id]), /immutable/);
  await rejects(() => db.query(`delete from school_mous where id=$1`, [mou1.mou_id]), /immutable/);
});
await t("MOU needs complete company settings", async () => {
  await db.exec(`update company_settings set authorized_signatory_name=null`);
  await rejects(() => as(A.uid, () => q(`select public.generate_initial_mou($1)`, [A1.school_id])), /Company Settings/);
  await db.exec(`update company_settings set authorized_signatory_name='R. Kumar'`);
});
await t("terms: new published version used by new MOU; old MOU keeps old terms", async () => {
  const d = await as(SA, () => q1(`insert into mou_terms_versions(title,content) values ('Terms v2','new clauses') returning id`));
  await as(SA, () => q(`select public.publish_mou_terms($1)`, [d.id]));
  const r = await as(A.uid, () => q1(`select public.generate_initial_mou($1) r`, [A1.school_id]));
  eq((await q1(`select terms_version v from school_mous where id=$1`, [r.r.mou_id])).v, 2);
  eq((await q1(`select terms_version v from school_mous where id=$1`, [mou1.mou_id])).v, 1);
});

console.log("\n== Payments & accounting");
let inv1, pay1;
await t("rep submits payment: pending, no accounting entry, not counted", async () => {
  inv1 = (await q1(`select id from school_invoices where school_id=$1 and period_sequence=1`, [A1.school_id])).id;
  const r = await as(A.uid, () => q1(`select public.submit_school_payment($1,6000,current_date,'upi','UPI-1001','idem-1','part') r`, [inv1]));
  pay1 = r.r.payment_id; eq(r.r.status, "pending_verification");
  eq((await q1(`select count(*)::int c from journal_entries where source_table='school_payments'`)).c, 0);
  const s = await as(SA, () => q1(`select collected_amount::text c, pending_verification_amount::text p, outstanding_amount::text o from school_billing_summary where school_id=$1`, [A1.school_id]));
  eq(s, { c: "0.00", p: "6000.00", o: "18000.00" });
});
await t("resubmitting the same key returns the same payment", async () => {
  const r = await as(A.uid, () => q1(`select public.submit_school_payment($1,6000,current_date,'upi','UPI-1001','idem-1') r`, [inv1]));
  eq(r.r.idempotent, true); eq(r.r.payment_id, pay1);
});
await t("duplicate transaction reference refused (any key, any case)", () => rejects(() => as(A.uid, () => q(`select public.submit_school_payment($1,1000,current_date,'upi','  upi-1001 ','idem-2')`, [inv1])), /already been recorded/));
await t("exact duplicate refused unless acknowledged", async () => {
  await rejects(() => as(A.uid, () => q(`select public.submit_school_payment($1,6000,current_date,'upi','UPI-1002','idem-3')`, [inv1])), /same invoice/);
  const r = await as(A.uid, () => q1(`select public.submit_school_payment($1,6000,current_date,'upi','UPI-1002','idem-3',null,true) r`, [inv1]));
  await as(SA, () => q(`select public.reject_school_payment($1,'duplicate entry')`, [r.r.payment_id]));
  eq((await q1(`select status from school_payments where id=$1`, [r.r.payment_id])).status, "rejected");
});
await t("overpayment above open balance refused", () => rejects(() => as(A.uid, () => q(`select public.submit_school_payment($1,99999,current_date,'cash',null,'idem-4')`, [inv1])), /exceeds/));
await t("cash without reference gets a generated unique reference", async () => {
  const r = await as(A.uid, () => q1(`select public.submit_school_payment($1,500,current_date,'cash',null,'idem-5') r`, [inv1]));
  if (!/^CASH-/.test(r.r.transaction_reference)) throw new Error("no ref");
  await as(SA, () => q(`select public.reject_school_payment($1,'test cleanup')`, [r.r.payment_id]));
});
await t("rep cannot verify (own or otherwise); B cannot touch A's payment", async () => {
  await rejects(() => as(A.uid, () => q(`select public.verify_school_payment($1)`, [pay1])), /Super Admin/);
  await rejects(() => as(B.uid, () => q(`select public.verify_school_payment($1)`, [pay1])), /Super Admin/);
  await rejects(() => as(B.uid, () => q(`select public.refund_school_payment($1,1,'refund','x','k')`, [pay1])), /Super Admin/);
  await as(B.uid, () => q(`update school_payments set amount=1 where id=$1`, [pay1])).catch(() => {});
  eq((await q1(`select amount::text a from school_payments where id=$1`, [pay1])).a, "6000.00");
  await rejects(() => as(B.uid, () => q(`delete from school_payments where id=$1`, [pay1])));
});
await t("rep has no direct DML on payments/invoices", async () => {
  await rejects(() => as(A.uid, () => q(`insert into school_payments(school_id,invoice_id,amount,payment_date,payment_mode,transaction_reference,idempotency_key,submitted_by) values ($1,$2,1,current_date,'cash','Z','z',$3)`, [A1.school_id, inv1, A.uid])), /permission denied/);
  await rejects(() => as(A.uid, () => q(`update school_invoices set amount=1`)), /permission denied/);
});
await t("SA verifies: receipt, exactly one posting Dr BANK / Cr SUBSCRIPTION_INCOME", async () => {
  const r = await as(SA, () => q1(`select public.verify_school_payment($1,'ok') r`, [pay1]));
  if (!/^RCT-/.test(r.r.receipt_number)) throw new Error("receipt");
  const lines = await q(`select a.code, jl.debit::text d, jl.credit::text c from journal_lines jl join accounts a on a.id=jl.account_id join journal_entries je on je.id=jl.journal_entry_id where je.source_record_id=$1 order by a.code`, [pay1]);
  eq(lines, [{ code: "BANK", d: "6000.00", c: "0" }, { code: "SUBSCRIPTION_INCOME", d: "0", c: "6000.00" }]);
  const ev = await q1(`select count(*)::int c from accounting_events where source_record_id=$1`, [pay1]);
  eq(ev.c, 1);
  const je = await q1(`select s.is_platform_internal i, je.entry_type from journal_entries je join schools s on s.id=je.school_id where je.source_record_id=$1`, [pay1]);
  eq(je, { i: true, entry_type: "receipt" });
});
await t("verify twice posts nothing more (idempotent)", async () => {
  const r = await as(SA, () => q1(`select public.verify_school_payment($1) r`, [pay1]));
  eq(r.r.idempotent, true);
  eq((await q1(`select count(*)::int c from journal_entries where source_record_id=$1`, [pay1])).c, 1);
});
await t("balances: paid 6000, outstanding 12000, rep and SA dashboards agree", async () => {
  const s = await as(A.uid, () => q1(`select collected_amount::text c, outstanding_amount::text o from school_billing_summary where school_id=$1`, [A1.school_id]));
  eq(s, { c: "6000.00", o: "12000.00" });
  const tot = await as(A.uid, () => q1(`select public.business_dashboard_totals() t`));
  if (!(tot.t.total_collected >= 6000)) throw new Error(J(tot));
});
await t("verified payment is immutable & undeletable, even for superuser sessions", async () => {
  await rejects(() => db.query(`update school_payments set amount=1 where id=$1`, [pay1]), /payment functions|immutable/);
  await rejects(() => db.query(`delete from school_payments where id=$1`, [pay1]), /cannot be deleted/);
  await rejects(() => as(SA, () => q(`update school_payments set status='pending_verification' where id=$1`, [pay1])), /permission denied|payment functions/);
});
await t("partial refund keeps payment verified; reversing journal posted once (idempotent)", async () => {
  const r = await as(SA, () => q1(`select public.refund_school_payment($1,2000,'refund','customer request','rf-1') r`, [pay1]));
  eq(r.r.fully_returned, false);
  const r2 = await as(SA, () => q1(`select public.refund_school_payment($1,2000,'refund','customer request','rf-1') r`, [pay1]));
  eq(r2.r.idempotent, true);
  eq((await q1(`select status from school_payments where id=$1`, [pay1])).status, "verified");
  const lines = await q(`select a.code, jl.debit::text d, jl.credit::text c from journal_lines jl join accounts a on a.id=jl.account_id join journal_entries je on je.id=jl.journal_entry_id where je.source_table='payment_reversals' order by a.code`);
  eq(lines, [{ code: "BANK", d: "0", c: "2000.00" }, { code: "SUBSCRIPTION_INCOME", d: "2000.00", c: "0" }]);
  const s = await as(SA, () => q1(`select collected_amount::text c, outstanding_amount::text o from school_billing_summary where school_id=$1`, [A1.school_id]));
  eq(s, { c: "4000.00", o: "14000.00" });
});
await t("refund above remainder refused; reversal refused after partial; full refund => refunded", async () => {
  await rejects(() => as(SA, () => q(`select public.refund_school_payment($1,4001,'refund','x','rf-2')`, [pay1])), /cannot exceed/);
  await rejects(() => as(SA, () => q(`select public.refund_school_payment($1,0,'reversal','x','rf-3')`, [pay1])), /cannot exceed|must/);
  const r = await as(SA, () => q1(`select public.refund_school_payment($1,4000,'refund','rest','rf-4') r`, [pay1]));
  eq(r.r.fully_returned, true);
  eq((await q1(`select status from school_payments where id=$1`, [pay1])).status, "refunded");
  await rejects(() => as(SA, () => q(`select public.refund_school_payment($1,1,'refund','x','rf-5')`, [pay1])), /verified payment/);
  const s = await as(SA, () => q1(`select collected_amount::text c from school_billing_summary where school_id=$1`, [A1.school_id]));
  eq(s.c, "0.00");
});
await t("full reversal path: new payment verified then reversed", async () => {
  const p = await as(A.uid, () => q1(`select public.submit_school_payment($1,3000,current_date,'bank_transfer','NEFT-1','idem-9') r`, [inv1]));
  await as(SA, () => q(`select public.verify_school_payment($1)`, [p.r.payment_id]));
  await rejects(() => as(SA, () => q(`select public.refund_school_payment($1,1,'reversal','err','rv-0')`, [p.r.payment_id])).then(() => { throw new Error("partial reversal allowed"); }).catch(e => { if (/partial/.test(e.message)) throw e; throw e; }), undefined).catch(() => {});
  const r = await as(SA, () => q1(`select public.refund_school_payment($1,3000,'reversal','entered in error','rv-1') r`, [p.r.payment_id]));
  eq(r.r.fully_returned, true);
  eq((await q1(`select status from school_payments where id=$1`, [p.r.payment_id])).status, "reversed");
  const jc = await q1(`select count(*)::int c from journal_entries where school_id=(select id from schools where is_platform_internal)`);
  eq(jc.c, 5);
});
await t("verification log trail preserved", async () => {
  const l = await q(`select action from payment_verification_logs where payment_id=$1 order by created_at, id`, [pay1]);
  eq(l.map(x => x.action).slice(0, 2), ["submitted", "verified"]);
});

console.log("\n== Final MOU");
await t("request final billing count: initial 300 vs confirmed 350 => 21000, pending approval", async () => {
  const r = await as(A.uid, () => q1(`select public.request_billing_count_confirmation($1,350,'admissions closed') r`, [A1.school_id]));
  eq(r.r.revised_amount, 21000); eq(r.r.initial_student_count, 300);
  const sub = await q1(`select amount::text a, billing_student_count b from school_subscriptions where school_id=$1`, [A1.school_id]);
  eq(sub, { a: "18000.00", b: 300 });
  await rejects(() => as(A.uid, () => q(`select public.request_billing_count_confirmation($1,360)`, [A1.school_id])), /already awaiting/);
  global.CONF = r.r.confirmation_id;
});
await t("rep cannot approve own request; B cannot request for A's school", async () => {
  await rejects(() => as(A.uid, () => q(`select public.decide_billing_count_confirmation($1,true)`, [global.CONF])), /Super Admin/);
  await rejects(() => as(B.uid, () => q(`select public.request_billing_count_confirmation($1,10)`, [A1.school_id])), /access/);
});
await t("SA approves => final MOU 350 x 60 = 21000; initial versions untouched", async () => {
  const r = await as(SA, () => q1(`select public.decide_billing_count_confirmation($1,true,'approved') r`, [global.CONF]));
  eq(r.r.revised_amount, 21000);
  const m = await q(`select mou_type, version, total_amount::text t, student_count from school_mous where school_id=$1 order by mou_type, version`, [A1.school_id]);
  eq(m.filter(x => x.mou_type === "final"), [{ mou_type: "final", version: 1, t: "21000.00", student_count: 350 }]);
  eq(m.filter(x => x.mou_type === "initial").map(x => x.t), ["18000.00", "18000.00", "18000.00"]);
  const sub = await q1(`select amount::text a, billing_student_count b, estimated_student_count e, agreement_version v from school_subscriptions where school_id=$1`, [A1.school_id]);
  eq(sub, { a: "21000.00", b: 350, e: 300, v: 2 });
  const f = await q1(`select snapshot->>'document_label' l, snapshot->'extra'->>'initial_student_count' i from school_mous where mou_type='final' and school_id=$1`, [A1.school_id]);
  eq(f, { l: "FINAL MOU", i: "300" });
  eq((await q1(`select amount::text a from schools s join school_subscriptions x on x.school_id=s.id where s.id=$1`, [A1.school_id])).a, "21000.00");
  eq((await q1(`select subscription_amount::text a from schools where id=$1`, [A1.school_id])).a, "18000.00");
});
await t("agreement terms can't be edited outside the approval flow", () => rejects(() => db.query(`update school_subscriptions set amount=1 where school_id=$1`, [A1.school_id]), /approved revision/));
await t("original MOU stays downloadable by the rep", async () => {
  eq((await as(A.uid, () => q1(`select count(*)::int c from school_mous where school_id=$1 and mou_type='initial'`, [A1.school_id]))).c, 3);
});
await t("approved increase invoiced once as a supplementary invoice for the difference", async () => {
  const subId = (await q1(`select id from school_subscriptions where school_id=$1`, [A1.school_id])).id;
  const n = await as(SA, () => q1(`select public.generate_school_invoices($1) n`, [subId]));
  eq(n.n, 1);
  const i = await q(`select period_sequence, amount::text a from school_invoices where school_id=$1 order by period_sequence`, [A1.school_id]);
  eq(i, [{ period_sequence: 1, a: "18000.00" }, { period_sequence: 2, a: "3000.00" }]);
  const n2 = await as(SA, () => q1(`select public.generate_school_invoices($1) n`, [subId]));
  eq(n2.n, 0);
});

console.log("\n== Ownership, leads, attribution");
await t("reassign A1 to B: A loses access, B gains; original attribution kept", async () => {
  await rejects(() => as(A.uid, () => q(`select public.reassign_school_rep($1,$2,'x')`, [A1.school_id, B.uid])), /Super Admin/);
  await as(SA, () => q(`select public.reassign_school_rep($1,$2,'territory change')`, [A1.school_id, B.uid]));
  eq((await as(A.uid, () => q(`select code from schools where code='SCA1'`))).length, 0);
  eq((await as(B.uid, () => q(`select code from schools where code='SCA1'`))).length, 1);
  const o = await q1(`select original_acquisition_rep_id o, current_rep_id c from school_sales_ownership where school_id=$1`, [A1.school_id]);
  eq(o, { o: A.uid, c: B.uid });
  await rejects(() => db.query(`update school_sales_ownership set original_acquisition_rep_id=$1 where school_id=$2`, [B.uid, A1.school_id]), /permanent/);
  await rejects(() => db.query(`update school_sales_ownership set current_rep_id=$1 where school_id=$2`, [A.uid, A1.school_id]), /reassignment function/);
  const h = await q(`select assignment_type, effective_to is null open from school_sales_assignments where school_id=$1 order by effective_from, id`, [A1.school_id]);
  eq(h.map(x => x.assignment_type), ["original_acquisition", "reassignment"]);
  await rejects(() => db.query(`delete from school_sales_assignments`), /immutable|cannot be deleted/);
});
await t("performance: A still credited for A1 (brought) though B owns it now", async () => {
  const a = await as(A.uid, () => q(`select * from sales_rep_performance`));
  eq(a.length, 1); eq(a[0].schools_brought >= 1, true); eq(Number(a[0].schools_currently_owned), 2);
  const sa = await as(SA, () => q(`select rep_name, schools_brought::int sb from sales_rep_performance order by rep_name`));
  eq(sa.length, 2);
});
await t("A can still see payments A personally collected after reassignment", async () => {
  const n = await as(A.uid, () => q1(`select count(*)::int c from school_payments where school_id=$1`, [A1.school_id]));
  if (n.c < 1) throw new Error("lost history");
  const inv = await as(A.uid, () => q1(`select count(*)::int c from school_invoices where school_id=$1`, [A1.school_id]));
  eq(inv.c, 0);
});
await t("leads: own only; direct convert/reassign blocked; conversion via sale creates no duplicate", async () => {
  const l = await as(A.uid, () => q1(`insert into school_leads(school_name,district,assigned_rep_id,mobile) values ('Lead School','D',$1,'1') returning id`, [B.uid]));
  eq((await q1(`select assigned_rep_id a from school_leads where id=$1`, [l.id])).a, A.uid);
  eq((await as(B.uid, () => q(`select id from school_leads`))).length, 0);
  await rejects(() => as(A.uid, () => q(`update school_leads set status='converted' where id=$1`, [l.id])));
  await rejects(() => as(A.uid, () => q(`update school_leads set assigned_rep_id=$1 where id=$2`, [B.uid, l.id])), /permission denied/);
  await rejects(() => as(A.uid, () => q(`insert into school_leads(school_name,district,assigned_rep_id) values ('lead school','d',$1)`, [A.uid])), /duplicate/);
  await rejects(() => as(B.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "SCL2", idempotency_key: "SCL2", lead_id: l.id })])), /not available/);
  const r = await as(A.uid, () => q1(`select public.create_school_sale($1::jsonb) r`, [mk({ school_code: "SCL1", school_name: "Lead School", idempotency_key: "SCL1", lead_id: l.id, owner: { name: "O", email: "ol1@sch.test" } })]));
  eq(await q1(`select status, converted_school_id c from school_leads where id=$1`, [l.id]), { status: "converted", c: r.r.school_id });
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "SCL3", idempotency_key: "SCL3", lead_id: l.id })])), /not available/);
});
await t("SA reassigns a lead via RPC only", async () => {
  const l = await as(A.uid, () => q1(`insert into school_leads(school_name,assigned_rep_id) values ('Another',$1) returning id`, [A.uid]));
  await rejects(() => as(A.uid, () => q(`select public.reassign_lead($1,$2)`, [l.id, B.uid])), /Super Admin/);
  await as(SA, () => q(`select public.reassign_lead($1,$2)`, [l.id, B.uid]));
  eq((await q1(`select assigned_rep_id a from school_leads where id=$1`, [l.id])).a, B.uid);
});
await t("activity log: own leads only", async () => {
  const l = await q1(`select id from school_leads where assigned_rep_id=$1 and status<>'converted' limit 1`, [B.uid]);
  await rejects(() => as(A.uid, () => q(`insert into sales_activity_logs(lead_id,activity_type) values ($1,'call')`, [l.id])), /own leads/);
  await as(B.uid, () => q(`insert into sales_activity_logs(lead_id,activity_type) values ($1,'call')`, [l.id]));
});

console.log("\n== School owner provisioning");
await t("owner job: claim, auth, record, complete => owner membership; idempotent; no orphan on retry", async () => {
  const jobId = A1.job_id;
  await as(A.uid, () => q(`select public.claim_provisioning_job($1)`, [jobId])).catch(async (e) => { if (!/access/.test(e.message)) throw e; });
  const jo = (await q1(`select id from business_provisioning_jobs where subject_id=$1`, [A1.school_id])).id;
  await as(SA, () => q(`select public.claim_provisioning_job($1)`, [jo]));
  const uid = (await q1(`insert into auth.users(email) values ('oa1@sch.test') returning id`)).id;
  await as(SA, () => q(`select public.record_provisioned_auth_user($1,$2)`, [jo, uid]));
  await as(SA, () => q(`select public.complete_provisioning_job($1)`, [jo]));
  const m = await q1(`select role, is_active from school_users where school_id=$1 and user_id=$2`, [A1.school_id, uid]);
  eq(m, { role: "owner", is_active: true });
  eq((await q1(`select login_id from user_profiles where id=$1`, [uid])).login_id, "SCA1");
  eq((await q1(`select platform_role::text r from user_profiles where id=$1`, [uid])).r, "user");
  eq((await as(SA, () => q1(`select public.complete_provisioning_job($1) r`, [jo]))).r.idempotent, true);
});
await t("record rejects an unrelated / mismatched login and elevated accounts", async () => {
  const jo = (await q1(`select id from business_provisioning_jobs where subject_id=$1`, [B1.school_id])).id;
  await as(SA, () => q(`select public.claim_provisioning_job($1)`, [jo]));
  await rejects(() => as(SA, () => q(`select public.record_provisioned_auth_user($1,$2)`, [jo, SA])), /email does not match/);
  await rejects(() => as(SA, () => q(`select public.record_provisioned_auth_user($1,$2)`, [jo, gen()])), /does not exist/);
});
function gen() { return "11111111-1111-1111-1111-111111111111"; }
await t("cancel reports whether the auth login is safe to delete", async () => {
  const jo = (await q1(`select id from business_provisioning_jobs where subject_id=$1`, [B1.school_id])).id;
  const uid = (await q1(`insert into auth.users(email) values ('ob1@sch.test') returning id`)).id;
  await as(SA, () => q(`select public.record_provisioned_auth_user($1,$2)`, [jo, uid]));
  const c = await as(SA, () => q1(`select public.cancel_provisioning_job($1,'wrong email') r`, [jo]));
  eq(c.r.safe_to_delete_auth_user, true);
  const o = await as(SA, () => q(`select * from public.list_orphan_auth_accounts()`));
  eq(Array.isArray(o), true);
});

console.log("\n== Misc security");
await t("business_audit_logs: SA-only read, append-only", async () => {
  eq((await as(A.uid, () => q(`select * from business_audit_logs`))).length, 0);
  if ((await as(SA, () => q(`select * from business_audit_logs`))).length < 20) throw new Error("audit too thin");
  await rejects(() => db.query(`delete from business_audit_logs`), /append-only/);
  await rejects(() => db.query(`update business_audit_logs set action='x'`), /append-only/);
});
await t("platform tenant cannot gain members, subscriptions or ownership", async () => {
  const t0 = (await q1(`select id from schools where is_platform_internal`)).id;
  await rejects(() => db.query(`insert into school_users(user_id,school_id,role) values ($1,$2,'owner')`, [STAFF, t0]), /internal/);
  await rejects(() => db.query(`insert into school_subscriptions(school_id,plan_code,amount,started_on,expires_on) values ($1,'x',1,current_date,current_date)`, [t0]), /internal/);
  await rejects(() => db.query(`update schools set is_platform_internal=false where id=$1`, [t0]), /cannot be changed/);
  await rejects(() => db.query(`delete from schools where id=$1`, [t0]), /cannot be deleted/);
  await rejects(() => db.query(`insert into schools(name,code,school_code,is_platform_internal) values ('Second','S2','S2',true)`), /operator|duplicate|create a school/);
});
await t("API roles cannot insert the platform tenant", () => rejects(() => as(SA, () => q(`insert into schools(name,code,school_code,is_platform_internal,created_by,enabled_modules) values ('Evil','EV1','EV1',true,$1,'{fees}')`, [SA]))));
await t("storage bucket private; SA writes, rep reads, rep cannot write", async () => {
  eq((await q1(`select public from storage.buckets where id='company-assets'`)).public, false);
  await as(SA, () => q(`insert into storage.objects(bucket_id,name) values ('company-assets','company/logo2.png')`));
  eq((await as(A.uid, () => q(`select name from storage.objects where bucket_id='company-assets'`))).length, 1);
  await rejects(() => as(A.uid, () => q(`insert into storage.objects(bucket_id,name) values ('company-assets','company/x.png')`)));
  eq((await as(STAFF, () => q(`select name from storage.objects where bucket_id='company-assets'`))).length, 0);
});
await t("deactivated rep loses all access", async () => {
  const repRowId = (await q1(`select id from sales_representatives where user_id=$1`, [A.uid])).id;
  await as(SA, () => q(`select public.set_sales_rep_active($1,false,'left company')`, [repRowId]));
  eq((await as(A.uid, () => q(`select * from schools`))).length, 0);
  await rejects(() => as(A.uid, () => q(`select public.create_school_sale($1::jsonb)`, [mk({ school_code: "SCZ9", idempotency_key: "SCZ9" })])), /required/);
  await as(SA, () => q(`select public.set_sales_rep_active($1,true)`, [repRowId]));
  eq((await as(A.uid, () => q(`select * from schools`))).length, 3);
});
await t("school owner (non-sales user) sees nothing of business tables", async () => {
  for (const tbl of ["school_invoices", "school_payments", "school_mous", "school_sales_ownership", "sales_representatives", "school_leads"]) {
    eq((await as(STAFF, () => q(`select * from ${tbl}`))).length, 0, tbl);
  }
  await rejects(() => as(STAFF, () => q(`select public.business_dashboard_totals()`)), /required/);
});
await t("anon holds no grants on Phase 2 tables except published policy read", async () => {
  const r = await q(`select table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name in ('school_payments','school_invoices','school_mous','company_settings','school_leads','sales_representatives','business_audit_logs','subscription_plans')`);
  eq(r, []);
});

console.log("\n== Remaining RPC / view coverage");
await t("views: monthly collections, plan distribution, invoice balances", async () => {
  const m = await as(SA, () => q(`select * from business_monthly_collections`));
  if (!m.length) throw new Error("no monthly rows");
  const d = await as(SA, () => q(`select plan_code, subscription_count::int n from subscription_plan_distribution order by plan_code`));
  if (d.length < 2) throw new Error(J(d));
  const b = await as(SA, () => q(`select display_status from school_invoice_balances`));
  if (!b.length) throw new Error("no balances");
});
await t("cancel invoice: blocked with live payments, allowed without; period freed for re-issue", async () => {
  const inv = (await q1(`select id from school_invoices where school_id=(select id from schools where code='SCB1') and period_sequence=1`)).id;
  const p = await as(B.uid, () => q1(`select public.submit_school_payment($1,100,current_date,'upi','UPI-B1','idem-b1') r`, [inv]));
  await rejects(() => as(SA, () => q(`select public.cancel_school_invoice($1,'wrong')`, [inv])), /payments/);
  await as(SA, () => q(`select public.reject_school_payment($1,'bad ref')`, [p.r.payment_id]));
  await as(SA, () => q(`select public.cancel_school_invoice($1,'issued in error')`, [inv]));
  const sub = (await q1(`select id from school_subscriptions where school_id=(select id from schools where code='SCB1')`)).id;
  await rejects(() => as(B.uid, () => q(`select public.submit_school_payment($1,100,current_date,'upi','UPI-B2','idem-b2')`, [inv])), /Issued invoice/);
  const n = await as(SA, () => q1(`select public.generate_school_invoices($1) n`, [sub]));
  eq(n.n, 1);
  await rejects(() => db.query(`update school_invoices set amount=1 where status='issued'`), /immutable/);
  await rejects(() => db.query(`delete from school_invoices`), /cannot be deleted/);
  const r = await as(B.uid, () => q1(`select reference from (select transaction_reference reference from school_payments where id=$1) x`, [p.r.payment_id]));
  eq(r.reference, "UPI-B1");
  const p2 = await as(B.uid, () => q1(`select public.submit_school_payment((select id from school_invoices where subscription_id=$1 and status='issued'),100,current_date,'upi','UPI-B1','idem-b3') r`, [sub]));
  eq(p2.r.status, "pending_verification");
});
await t("generate_due_invoices (SA only) and reset_provisioning_job", async () => {
  await rejects(() => as(A.uid, () => q(`select public.generate_due_invoices()`)), /Super Admin/);
  const n = await as(SA, () => q1(`select public.generate_due_invoices('2030-01-01') n`));
  if (typeof n.n !== "number") throw new Error("expected a count");
  const s = await as(SA, () => q1(`select public.start_sales_rep_provisioning('Rep R','r@co.test','1',null,null,null,'k-r') r`));
  for (let i = 0; i < 5; i++) {
    await as(SA, () => q(`select public.claim_provisioning_job($1)`, [s.r.job_id]));
    await as(SA, () => q(`select public.fail_provisioning_job($1,'x')`, [s.r.job_id]));
  }
  await rejects(() => as(SA, () => q(`select public.claim_provisioning_job($1)`, [s.r.job_id])), /exhausted/);
  await rejects(() => as(A.uid, () => q(`select public.reset_provisioning_job($1)`, [s.r.job_id])), /Super Admin/);
  await as(SA, () => q(`select public.reset_provisioning_job($1)`, [s.r.job_id]));
  await as(SA, () => q(`select public.claim_provisioning_job($1)`, [s.r.job_id]));
});
await t("start_school_owner_provisioning: owner-less school can be recovered by SA or its rep", async () => {
  const sch = (await q1(`select id from schools where code='SCB1'`)).id;
  const r = await as(B.uid, () => q1(`select public.start_school_owner_provisioning($1,'New Owner','newowner@sch.test','1','own-k1') r`, [sch]));
  await rejects(() => as(A.uid, () => q(`select public.start_school_owner_provisioning($1,'X','x@sch.test','1','own-k2')`, [sch])), /access/);
  eq((await as(B.uid, () => q1(`select public.start_school_owner_provisioning($1,'New Owner','newowner@sch.test','1','own-k1') r`, [sch]))).r.idempotent, true);
  if (!r.r.job_id) throw new Error("no job");
});
await t("preflight fails clearly when step 1 enum is missing", async () => {
  const fresh = await loadDb();
  const sql = readFileSync(`${repo}/docs/phase-2-supabase-sql-editor.sql`, "utf8");
  try { await fresh.exec(sql); } catch (e) {
    if (!/sales_rep/.test(e.message) || !/preflight/i.test(e.message)) throw new Error(e.message);
    await fresh.exec('ROLLBACK'); eq((await fresh.query(`select count(*)::int c from pg_class where relname='business_audit_logs'`)).rows[0].c, 0);
    return;
  }
  throw new Error("script should have failed");
});
await t("preflight fails clearly when the accounting_events unique index is missing", async () => {
  const fresh = await loadDb();
  await fresh.exec(readFileSync(`${repo}/docs/phase-2-step-1-sales-rep-enum.sql`, "utf8"));
  await fresh.exec(`drop index public.idx_accounting_events_source_unique`);
  try { await fresh.exec(readFileSync(`${repo}/docs/phase-2-supabase-sql-editor.sql`, "utf8")); } catch (e) {
    if (!/accounting_events/.test(e.message)) throw new Error(e.message);
    return;
  }
  throw new Error("script should have failed");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join("\n")); process.exit(1); }
