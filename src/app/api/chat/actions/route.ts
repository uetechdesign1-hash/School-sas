import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type VendorInput = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
};

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Please sign in again before adding a vendor." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const requestBody = body as { action?: unknown; vendor?: VendorInput };
  if (requestBody.action !== "create_vendor") {
    return NextResponse.json({ error: "Unsupported assistant action." }, { status: 400 });
  }

  const vendorInput = requestBody.vendor;
  if (typeof vendorInput !== "object" || vendorInput === null) {
    return NextResponse.json({ error: "Vendor details are required." }, { status: 400 });
  }

  const name = readTrimmedString(vendorInput.name);
  const phone = readTrimmedString(vendorInput.phone);
  const email = readTrimmedString(vendorInput.email);

  if (!name) {
    return NextResponse.json({ error: "Vendor name is required." }, { status: 400 });
  }
  if (name.length > 200 || (phone?.length ?? 0) > 50 || (email?.length ?? 0) > 254) {
    return NextResponse.json({ error: "One or more vendor fields are too long." }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid vendor email address." }, { status: 400 });
  }

  let schoolId: string | null = null;
  const { data: rpcSchoolId, error: rpcError } =
    await supabase.rpc("get_my_school_id");

  if (!rpcError && typeof rpcSchoolId === "string" && rpcSchoolId) {
    schoolId = rpcSchoolId;
  } else {
    const { data: schoolUser, error: schoolUserError } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (schoolUserError) {
      return NextResponse.json(
        { error: "Unable to determine your active school." },
        { status: 500 },
      );
    }
    schoolId = schoolUser?.school_id ?? null;
  }

  if (!schoolId) {
    return NextResponse.json(
      { error: "Your account is not linked to an active school." },
      { status: 403 },
    );
  }

  const { data: vendor, error: insertError } = await supabase
    .from("vendors")
    .insert({
      school_id: schoolId,
      name,
      phone: phone || null,
      email: email || null,
    })
    .select("id, name")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "A vendor with this name already exists." },
        { status: 409 },
      );
    }
    if (insertError.code === "42501") {
      return NextResponse.json(
        { error: "You do not have permission to add vendors." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "Unable to save the vendor. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: `${vendor.name} was added successfully.`,
    vendor,
  });
}
