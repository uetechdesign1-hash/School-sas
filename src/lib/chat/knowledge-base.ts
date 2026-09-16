/**
 * =========================================================
 * EduNexa Assistant - Knowledge Base & Matching Engine
 * =========================================================
 *
 * This module is the brain of the EduNexa in-app chat agent.
 *
 * It contains a curated guide for every EduNexa page: what
 * the page is for, exactly what to enter (field by field),
 * the step-by-step workflow, tips and related pages.
 *
 * The matching engine is a lightweight, offline retrieval
 * system: it tokenizes the user's question and scores every
 * guide by keyword overlap, phrase matches and the page the
 * user is currently looking at. The best matching guide is
 * returned as a structured answer the chat widget renders.
 *
 * No API key, no network call, no cost.
 */

/* =========================================================
   TYPES
   ========================================================= */

export type GuideLink = {
  label: string;
  href: string;
};

export type ChatGuide = {
  id: string;
  /** e.g. "Add a new student" */
  title: string;
  /** Label of the linked page, e.g. "Add Student" */
  pageLabel: string;
  /** Page path this guide belongs to */
  href: string;
  /** Words / phrases users type that should match this guide */
  keywords: string[];
  /** One or two sentences shown above the steps */
  summary: string;
  /** Ordered step-by-step instructions */
  steps: string[];
  /** Extra tips / common mistakes */
  tips: string[];
  /** Links to pages the user may need next */
  related: GuideLink[];
};

export type ChatAnswer = {
  kind: "guide" | "smalltalk" | "fallback";
  /** Main reply text (intro / friendly line) */
  text: string;
  /** Guide title, only for kind === "guide" */
  title?: string;
  pageLabel?: string;
  href?: string;
  steps?: string[];
  tips?: string[];
  related?: GuideLink[];
};

/* =========================================================
   TEXT HELPERS
   ========================================================= */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "for", "with", "from",
  "about", "into", "onto", "upon", "within", "without", "how", "what",
  "which", "who", "whom", "whose", "when", "where", "why", "do", "does",
  "did", "can", "could", "would", "should", "will", "shall", "may",
  "might", "must", "is", "are", "was", "were", "be", "been", "being",
  "am", "have", "has", "had", "i", "you", "me", "my", "mine", "we",
  "our", "ours", "us", "your", "yours", "they", "them", "their", "he",
  "she", "it", "its", "this", "that", "these", "those", "there",
  "here", "not", "no", "yes", "of", "to", "in", "on", "at", "by", "as",
  "if", "then", "than", "too", "very", "just", "please", "pls", "plz",
  "want", "need", "know", "tell", "find", "help", "use", "used",
  "enter", "fill", "create", "add", "open", "go", "got", "get",
  "make", "put", "set", "see", "let", "show", "explain", "step",
  "steps", "again", "also", "anyway",
]);

/**
 * Lowercase, remove accents and punctuation, keep letters/numbers.
 */
export function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a message into meaningful tokens (no stopwords, length >= 2).
 */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

function stripPath(value: string): string {
  const path = (value || "").split("?")[0].split("#")[0].replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/* =========================================================
   GUIDES
   ========================================================= */

const GUIDES: ChatGuide[] = [
  /* ------------- AUTH & ONBOARDING ------------- */
  {
    id: "login",
    title: "Log in to EduNexa",
    pageLabel: "Login",
    href: "/login",
    keywords: [
      "login", "sign in", "signin", "log in", "sign into my school",
      "enter email and password", "cant login", "cannot sign in",
    ],
    summary:
      "The login page is where you sign in to your EduNexa account with the email and password you registered with.",
    steps: [
      "Open the EduNexa website and click Login (or open the login page directly).",
      "Enter the email address you used when your account was created.",
      "Type your password. Passwords are case-sensitive, so check that Caps Lock is off.",
      "Click the Sign In button. You will land on your dashboard.",
    ],
    tips: [
      "Forgot your password? Click 'Forgot password' and enter your email — a reset link will be emailed to you.",
      "If you get 'No active school membership', your school admin has not assigned you to a school yet; contact them.",
    ],
    related: [
      { label: "Forgot password", href: "/forgot-password" },
      { label: "Create account", href: "/signup" },
      { label: "Set up school", href: "/onboarding/school" },
    ],
  },
  {
    id: "signup",
    title: "Create an EduNexa account",
    pageLabel: "Sign Up",
    href: "/signup",
    keywords: [
      "sign up", "signup", "register", "create account", "new account",
      "open account", "create login", "school owner account",
    ],
    summary:
      "Sign up creates your EduNexa account. After signing up you will set up your school details on the onboarding page.",
    steps: [
      "Click 'Sign up' from the home page or open the signup page.",
      "Fill in your name, email and a strong password.",
      "Submit the form and verify your email if asked.",
      "Complete the School onboarding form that follows so your school workspace is ready.",
    ],
    tips: [
      "Use an email you check often — password reset and important notifications go there.",
      "Your school is created later on the School Setup page; keep your details handy.",
    ],
    related: [
      { label: "Set up school details", href: "/onboarding/school" },
      { label: "Login", href: "/login" },
    ],
  },
  {
    id: "onboarding-school",
    title: "Set up your school",
    pageLabel: "School Setup",
    href: "/onboarding/school",
    keywords: [
      "onboarding", "school setup", "set up school", "school details",
      "school name", "school address", "school phone", "affiliation",
      "setup my school", "new school",
    ],
    summary:
      "This page collects your school's basic information. Fill it once — these details appear on reports, receipts and invoices.",
    steps: [
      "Enter the official School Name exactly as it should appear on receipts and reports.",
      "Fill the School Address (street, area).",
      "Enter City and State.",
      "Add the School Phone number and, if available, a contact Email.",
      "Click Save. You will be taken into your school dashboard.",
    ],
    tips: [
      "A clean, correct school name and address avoids re-printing receipts later.",
      "You can update some of these details later, but doing it right now saves time.",
    ],
    related: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Academic years", href: "/dashboard/academic-years" },
      { label: "Classes & sections", href: "/dashboard/classes" },
    ],
  },
  {
    id: "forgot-password",
    title: "Reset a forgotten password",
    pageLabel: "Forgot Password",
    href: "/forgot-password",
    keywords: [
      "forgot password", "reset password", "change password",
      "cannot login", "forgot my password", "password reset", "recover password",
    ],
    summary:
      "Use this page whenever you (or a user) cannot remember a password. A secure reset link is emailed automatically.",
    steps: [
      "Go to the Forgot password page from the login screen.",
      "Type the email address registered on the account.",
      "Click the reset button — EduNexa emails a password-reset link.",
      "Open the link from your inbox, enter a new password and confirm it.",
      "Return to Login and sign in with the new password.",
    ],
    tips: [
      "Check the Spam/Junk folder if the email doesn't arrive within a few minutes.",
      "Reset links expire after a short time — use it as soon as it arrives.",
    ],
    related: [
      { label: "Login", href: "/login" },
      { label: "Staff password reset", href: "/dashboard/staff" },
    ],
  },

  /* ------------- DASHBOARD FOUNDATION ------------- */
  {
    id: "dashboard-overview",
    title: "Understand the Dashboard",
    pageLabel: "Dashboard",
    href: "/dashboard",
    keywords: [
      "dashboard", "home page", "overview", "summary cards",
      "main screen", "what is on dashboard", "quick links",
    ],
    summary:
      "The dashboard is your home base. It shows your school details, key totals and shortcuts to the most used pages.",
    steps: [
      "Read the header cards — they show key totals such as students, staff, fees collected or expenses.",
      "Check your School Code, Status ('active' or 'trial') and Plan near your school name.",
      "Use the shortcuts (e.g. Classes, Add Student) to jump into common tasks.",
      "Use the left sidebar (or bottom menu on mobile) to open Students, Fees, Attendance, Staff, Reports and more.",
    ],
    tips: [
      "Your Role is shown on the dashboard — it decides which menu you see.",
      "Staff members land on a different dashboard (Staff Portal), not this admin dashboard.",
    ],
    related: [
      { label: "Academic years", href: "/dashboard/academic-years" },
      { label: "Classes & sections", href: "/dashboard/classes" },
      { label: "Students", href: "/dashboard/students" },
    ],
  },
  {
    id: "academic-years",
    title: "Add an academic year",
    pageLabel: "Academic Years",
    href: "/dashboard/academic-years",
    keywords: [
      "academic year", "session", "school session", "new session",
      "start date", "end date", "current academic year", "2026 2027",
      "set current year",
    ],
    summary:
      "Academic years are the school sessions (for example '2026-2027'). Students, fee bills and attendance all link to an academic year, so set the current one correctly.",
    steps: [
      "Click Add Academic Year.",
      "Enter a Name, e.g. '2026-2027' (keep the same format every year for clean reports).",
      "Pick the Start Date and End Date of the session (End must be after Start).",
      "Mark it as the Current academic year if this is the active session.",
      "Save. The new year is now available when adding students and fee structures.",
    ],
    tips: [
      "Duplicate names are rejected — use unique session labels.",
      "Make sure exactly one year is 'Current'; reports and fee bills depend on it.",
    ],
    related: [
      { label: "Classes & sections", href: "/dashboard/classes" },
      { label: "Fee structure", href: "/dashboard/fees/structure" },
      { label: "Students", href: "/dashboard/students" },
    ],
  },
  {
    id: "classes",
    title: "Create classes and sections",
    pageLabel: "Classes & Sections",
    href: "/dashboard/classes",
    keywords: [
      "class", "section", "add class", "create class", "add section",
      "grade", "class 1", "classroom", "sections a b", "divisions",
    ],
    summary:
      "This page manages your school's classes (e.g. Class 1, Grade 6) and their sections (e.g. A, B). Use it before adding students so they have a class to join.",
    steps: [
      "Type a Class Name, for example 'Class 1' or 'Grade 6'.",
      "Optionally set a Display Order so classes appear in the right sequence.",
      "Save the class, then add Sections to it (for example 'A' and 'B').",
      "Repeat for every class in your school.",
    ],
    tips: [
      "Students are assigned to a Class + Section, so create these before adding students.",
      "You can also manage classes from the Modules section on your dashboard.",
    ],
    related: [
      { label: "Add student", href: "/dashboard/students/new" },
      { label: "Academic years", href: "/dashboard/academic-years" },
    ],
  },

  /* ------------- STUDENTS ------------- */
  {
    id: "students-list",
    title: "Find, filter and promote students",
    pageLabel: "Students",
    href: "/dashboard/students",
    keywords: [
      "student list", "students", "search student", "view students",
      "promote", "promote students", "transfer student", "all students",
      "list of students", "filter students",
    ],
    summary:
      "The Students page lists every student in your school. From here you can search, filter, open a student's profile, and promote students to the next class/year.",
    steps: [
      "Use the Search box to find a student by name, roll number or admission number.",
      "Filter by Class, Section or Academic Year if the list is long.",
      "Click a student to open their full profile (details, fees, history).",
      "To promote: select the students, choose the Target Academic Year + new Class/Section, and click Promote.",
    ],
    tips: [
      "Promotion only works for students active in the current academic year.",
      "After promotion the student moves to the new class/year and stays in your records.",
    ],
    related: [
      { label: "Add student", href: "/dashboard/students/new" },
      { label: "Academic years", href: "/dashboard/academic-years" },
      { label: "Classes & sections", href: "/dashboard/classes" },
    ],
  },
  {
    id: "students-new",
    title: "Add a new student (what to enter)",
    pageLabel: "Add Student",
    href: "/dashboard/students/new",
    keywords: [
      "add student", "new student", "admit", "admission", "student form",
      "register student", "what to enter student", "add admission",
      "student admission details",
    ],
    summary:
      "This form registers a new student with EduNexa. Required fields are marked; the rest can be filled as available.",
    steps: [
      "Fill Admission Number and Roll Number (the numbers your school uses for this student).",
      "Enter the student's full name: First Name (required), Middle Name and Last Name.",
      "Pick the Date of Birth, Gender, and the Admission Date.",
      "Enter the Admission Fee if one is charged — otherwise leave it blank or 0. Saving a positive value creates an admission fee bill.",
      "Choose the Status (Active is the default), and fill Blood Group if available.",
      "Select the Academic Year (required), Class and Section — these come from the years/classes you created.",
      "Fill Address, City, State, Postal Code and Notes (optional).",
      "Click Save. The student now appears in the Students list.",
    ],
    tips: [
      "Set up Academic Years and Classes before adding students, or the dropdowns will be empty.",
      "A positive Admission Fee automatically creates a fee bill for the student — you can collect it later in their Fees page.",
    ],
    related: [
      { label: "Students list", href: "/dashboard/students" },
      { label: "Academic years", href: "/dashboard/academic-years" },
      { label: "Classes & sections", href: "/dashboard/classes" },
    ],
  },
  {
    id: "student-details",
    title: "View or edit a student profile",
    pageLabel: "Student Profile",
    href: "/dashboard/students/[id]",
    keywords: [
      "student profile", "edit student", "student details", "update student",
      "view student", "student info", "change student data",
    ],
    summary:
      "Each student has a profile page with their personal details, enrollment info, and quick access to their fees and payment history.",
    steps: [
      "Open the student from the Students list by clicking their name.",
      "Review the profile sections: personal details, academic year, class/section, address, notes.",
      "Click Edit / use the form to update fields (same fields as when adding the student).",
      "Use the Fees / Payment / History buttons to manage that student's fee bills and payments.",
    ],
    tips: [
      "Changing the Class or Section moves the student for attendance and fee assignment.",
      "Keep the status updated (Active, Transferred, Completed, Alumni) so lists stay correct.",
    ],
    related: [
      { label: "Student fees", href: "/dashboard/students/[id]/fees" },
      { label: "Record payment", href: "/dashboard/students/[id]/payment" },
    ],
  },

  /* ------------- FEES ------------- */
  {
    id: "fee-structure",
    title: "Set up your fee structure",
    pageLabel: "Fee Structure",
    href: "/dashboard/fees/structure",
    keywords: [
      "fee structure", "fees", "tuition fee", "transport fee", "exam fee",
      "admission fee", "fee category", "fee frequency", "monthly fee",
      "annual fee", "structure name", "fee items",
    ],
    summary:
      "This page defines what your school charges. You create Fee Categories (Tuition Fee, Transport Fee, Exam Fee...) and then build Structures (the amounts & frequencies) per academic year and class.",
    steps: [
      "Create Fee Categories first — click to add a category like 'Tuition Fee' with a short description (e.g. 'Monthly tuition charge').",
      "Create a Fee Structure: give it a Name (e.g. 'Class 6 Annual Fees 2026-27').",
      "Choose the Academic Year and the Class this structure applies to.",
      "Add fee items to the structure: pick a category, enter the Amount, choose the Frequency (One Time, Annual, Monthly, Quarterly or Half Yearly).",
      "Mark an item Mandatory if the student must pay it.",
      "Save the structure. It is now ready to be assigned to students, and their bills are generated from it.",
    ],
    tips: [
      "Keep the structure name meaningful — it appears on student bills.",
      "A student's bill is created from the structure assigned to their Class + the Current Academic Year.",
    ],
    related: [
      { label: "Academic years", href: "/dashboard/academic-years" },
      { label: "Students", href: "/dashboard/students" },
      { label: "Student fees", href: "/dashboard/students/[id]/fees" },
    ],
  },
  {
    id: "student-fees",
    title: "Manage a student's fee bill",
    pageLabel: "Student Fees",
    href: "/dashboard/students/[id]/fees",
    keywords: [
      "student fees", "fee bill", "fee balance", "outstanding fees",
      "concession", "discount", "carry forward", "old fee", "fee history",
      "assign fee structure",
    ],
    summary:
      "Each student's Fees page shows their bills, balances and payments. From here you record payments, give concessions and carry forward old fees to the next year.",
    steps: [
      "Open the student, then the Fees tab. You will see the bill lines (category, frequency, annual amount) and the balance due.",
      "To collect money: click Record Payment, enter the amount to pay per line, choose the Payment Mode (Cash, Bank Transfer, UPI, Cheque, Card, Online or Other).",
      "If collecting across two accounts, split the amount into Cash Collection and Bank / Online Collection and pick the matching Cash/Bank account.",
      "Optionally enter the physical receipt number and a note for the transaction.",
      "Save — a receipt is generated and your Cash/Bank book updates automatically.",
      "Use Concession to reduce an amount (with an optional reason), and Carry Forward to move unpaid balances to the next academic year.",
    ],
    tips: [
      "The balance updates instantly after each payment; partial payments are fully supported.",
      "Old fee carry-forwards are shown as a separate 'Old Fee' line so current-year fees stay clear.",
    ],
    related: [
      { label: "Record payment", href: "/dashboard/students/[id]/payment" },
      { label: "Fee structure", href: "/dashboard/fees/structure" },
      { label: "Receipt", href: "/accounting/receipt" },
    ],
  },
  {
    id: "create-fee-bill",
    title: "Create a fee bill for a student",
    pageLabel: "Create Fee Bill",
    href: "/dashboard/students/[id]/fees/create",
    keywords: [
      "create bill", "new fee bill", "create fee bill", "fee bill manually",
      "add bill", "bill for student", "generate bill",
    ],
    summary:
      "This page creates a new fee bill for one student, either from their assigned fee structure or with custom line items.",
    steps: [
      "Open the student and choose Create Fee Bill.",
      "Give the bill a clear name / title (e.g. 'Annual Tuition Fee 2026-27').",
      "Pick the Fee Structure (based on class + academic year) to auto-fill the standard items, or add custom lines.",
      "For each line, enter the amount; set the frequency if not predefined.",
      "Save the bill. It appears on the student's Fees page and is ready for collection.",
    ],
    tips: [
      "The structure is matched by the student's class and the current academic year.",
      "You can always add extra one-off items later.",
    ],
    related: [
      { label: "Student fees", href: "/dashboard/students/[id]/fees" },
      { label: "Fee structure", href: "/dashboard/fees/structure" },
    ],
  },
  {
    id: "record-payment",
    title: "Record a fee payment",
    pageLabel: "Record Payment",
    href: "/dashboard/students/[id]/payment",
    keywords: [
      "record payment", "collect fee", "fee payment", "receive money",
      "cash", "upi", "cheque", "card payment", "receive payment",
      "collect fees from student",
    ],
    summary:
      "Use this page when a student pays you money so EduNexa can record it against their bill and issue a receipt.",
    steps: [
      "Open the student and open Record Payment (their outstanding balance is shown).",
      "Enter the amount being paid; partial payments are allowed.",
      "Choose the Payment Mode: Cash, Bank Transfer, UPI, Cheque, Card, Online or Other.",
      "For split collections, enter the Cash Amount and Bank/Online Amount with their accounts.",
      "Add an optional reference/receipt number and a note.",
      "Click Save. The payment posts to your Cash/Bank book and the fee balance reduces.",
    ],
    tips: [
      "Including a reference (cheque no., UPI ID) makes later reconciliation much easier.",
      "Payments automatically update accounting, so no separate journal entry is needed.",
    ],
    related: [
      { label: "Student fees", href: "/dashboard/students/[id]/fees" },
      { label: "Receipt", href: "/accounting/receipt" },
      { label: "Cash / Bank book", href: "/accounting/cash-bank" },
    ],
  },

  /* ------------- ATTENDANCE & EXPENSES ------------- */
  {
    id: "attendance",
    title: "Mark staff attendance",
    pageLabel: "Staff Attendance",
    href: "/dashboard/attendance",
    keywords: [
      "attendance", "mark attendance", "staff attendance", "present",
      "absent", "half day", "holiday", "week off", "casual leave",
      "attendance calendar", "mark present absent",
    ],
    summary:
      "The Attendance page is a month grid where you mark each staff member as Present, Absent, Half Day, Holiday, Week Off or Casual Leave. Unmarked cells are 'Auto' until you save.",
    steps: [
      "Pick the month/year at the top of the page.",
      "Click each staff member's cell for the day and select the status: P (Present), A (Absent), ½ (Half Day), H (Holiday), W/O (Week Off) or C/L (Casual Leave).",
      "Check-in / check-out times and working hours appear automatically for logged staff.",
      "Click Save when done — the grid is stored for that month.",
      "Use the Export button to download attendance as CSV if needed.",
    ],
    tips: [
      "Holidays and week-offs come from the school calendar; mark them once and reuse each year.",
      "Attendance feeds directly into Payroll — unpaid absences reduce net pay automatically.",
    ],
    related: [
      { label: "Payroll", href: "/dashboard/payroll" },
      { label: "Staff", href: "/dashboard/staff" },
      { label: "Reports", href: "/dashboard/reports" },
    ],
  },
  {
    id: "expenses",
    title: "Record an expense",
    pageLabel: "Expenses",
    href: "/dashboard/expenses",
    keywords: [
      "expense", "add expense", "record expense", "vendor", "invoice",
      "expense category", "paid from", "monthly expenses", "school expense",
      "enter expense",
    ],
    summary:
      "This page tracks every amount your school spends. You add an expense with a category, amount and paid-from account, and it automatically updates your Cash/Bank book.",
    steps: [
      "Click Add Expense (or the plus button).",
      "Choose the Expense Category (Salaries, Electricity, Transport, etc.) or add a new one.",
      "Pick the Expense Date and enter the Amount.",
      "Select the Paid From account — a Cash account for cash payments or a Bank account for cheque/UPI/bank transfers.",
      "Optionally add the Vendor/Supplier name, Invoice number and a Description.",
      "Save. The expense now appears in the list, and your accounting is updated automatically.",
    ],
    tips: [
      "Use vendor + invoice numbers consistently — it makes reports and reconciliations easy.",
      "Salary payments you make through the Payment page also show up here automatically.",
    ],
    related: [
      { label: "Payment", href: "/accounting/payment" },
      { label: "Cash / Bank book", href: "/accounting/cash-bank" },
      { label: "Reports", href: "/dashboard/reports" },
    ],
  },

  /* ------------- STAFF & PAYROLL ------------- */
  {
    id: "staff-directory",
    title: "Browse the staff directory",
    pageLabel: "Staff Directory",
    href: "/dashboard/staff",
    keywords: [
      "staff list", "staff directory", "teachers", "employees",
      "filter department", "designation list", "staff member", "staff roster",
    ],
    summary:
      "The Staff page is your school's staff directory. It lists every employee with their department, designation and status, and links to their profile, salary and payslips.",
    steps: [
      "Use the search box and the All Departments filter to narrow the list.",
      "Click any staff member to open their profile (details, documents, actions).",
      "From a profile you can edit details, set the salary structure, view payslips, mark attendance or reset their password.",
      "Click Add Staff when you need to register a new employee.",
    ],
    tips: [
      "Departments shown in the filter come from the staff records you have added.",
      "Only Owner/Admin roles see this directory — staff see only their own portal.",
    ],
    related: [
      { label: "Add staff", href: "/dashboard/staff/new" },
      { label: "Staff attendance", href: "/dashboard/attendance" },
      { label: "Payroll", href: "/dashboard/payroll" },
    ],
  },
  {
    id: "staff-new",
    title: "Add a new staff member (what to enter)",
    pageLabel: "Add Staff",
    href: "/dashboard/staff/new",
    keywords: [
      "add staff", "new staff", "add teacher", "employee number",
      "designation", "department", "joining date", "employment type",
      "register staff", "create staff login",
    ],
    summary:
      "This form registers a new employee in EduNexa. Fill the basics now — salary, attendance and payslips can be added later from their profile.",
    steps: [
      "Employee Number (required) — your school's unique code for this person, e.g. 'EMP-101'.",
      "Enter the full name: First Name (required), Middle Name, Last Name.",
      "Select Gender, Date of Birth, Phone number, and the Email (required — used to reset their password).",
      "Enter the Joining Date (required, defaults to today) and the address/city.",
      "Choose the Department and Designation, e.g. 'Teaching' / 'Math Teacher'.",
      "Select the Employment Type: Full Time, Part Time, Contract or Temporary, and the Status (Active).",
      "Optionally add a Photo URL.",
      "Save. Then, from their profile, you can create their staff login so they can use the Staff Portal.",
    ],
    tips: [
      "Employee numbers must be unique within the school.",
      "The email is essential — staff use it to reset their own password.",
    ],
    related: [
      { label: "Staff directory", href: "/dashboard/staff" },
      { label: "Salary structure", href: "/dashboard/staff/[id]/salary" },
      { label: "Staff portal", href: "/dashboard/staff/home" },
    ],
  },
  {
    id: "staff-salary",
    title: "Set a staff member's salary structure",
    pageLabel: "Salary Structure",
    href: "/dashboard/staff/[id]/salary",
    keywords: [
      "salary", "salary structure", "basic salary", "house allowance",
      "transport allowance", "other allowance", "deductions", "gross",
      "net salary", "monthly salary",
    ],
    summary:
      "Defines how much an employee is paid each month. EduNexa adds the allowances and subtracts deductions to calculate their Gross and Net pay.",
    steps: [
      "Open the staff member and go to their Salary page.",
      "Enter the Basic Salary.",
      "Add allowances: House Allowance, Transport Allowance, Other Allowance (leave blank if not applicable).",
      "Enter any Fixed Deductions (e.g. loan recovery, insurance).",
      "The Gross Monthly and Calculated Net update automatically — review them.",
      "Save. Payroll will now use this structure when you run the month.",
    ],
    tips: [
      "Set salaries before running payroll, otherwise staff appear with zero pay.",
      "Attendance (loss of pay for unpaid absences) is applied on top of this structure during payroll.",
    ],
    related: [
      { label: "Payroll", href: "/dashboard/payroll" },
      { label: "Staff directory", href: "/dashboard/staff" },
      { label: "Payment", href: "/accounting/payment" },
    ],
  },
  {
    id: "payroll",
    title: "Run monthly payroll",
    pageLabel: "Payroll",
    href: "/dashboard/payroll",
    keywords: [
      "payroll", "run payroll", "generate payroll", "monthly salary",
      "payslip", "attendance to salary", "lop", "net pay", "mark paid",
      "pay salaries",
    ],
    summary:
      "Payroll takes attendance + salary structures for a month and calculates what each staff member is paid, including loss of pay for unpaid absences. Flow: Attendance → Salary → Payment.",
    steps: [
      "Make sure staff have Salary Structures and the month's Attendance is marked.",
      "Open Payroll and pick the Month/Year. Staff load with their salary, worked days, paid leave and unpaid days.",
      "Review each row: Gross (from the salary structure), allowances, fixed deductions, LOP for unpaid absences, and the Calculated Net.",
      "Click Save / Generate — this creates the payroll run and the salary expense & salary payable entries in accounting.",
      "To actually pay an employee, go to Payment and choose the Payroll mode: select the staff member, Pay From (cash/bank account), and save — this also creates their payslip.",
    ],
    tips: [
      "Loading needs attendance data — 'Auto' cells that were never saved count as unpaid.",
      "Payments are per-employee, so one payroll run can be paid out across several payments.",
    ],
    related: [
      { label: "Salary structure", href: "/dashboard/staff/[id]/salary" },
      { label: "Attendance", href: "/dashboard/attendance" },
      { label: "Payment", href: "/accounting/payment" },
    ],
  },
  {
    id: "staff-portal",
    title: "Use the Staff Portal",
    pageLabel: "Staff Portal",
    href: "/dashboard/staff/home",
    keywords: [
      "staff portal", "my salary", "my payslips", "my attendance",
      "my profile", "staff login", "teacher login", "staff home",
      "attendance history",
    ],
    summary:
      "When staff sign in, they see the Staff Portal instead of the admin dashboard: their own attendance, salary, payslips and profile — nothing else.",
    steps: [
      "Sign in with your staff account (created by your school admin).",
      "Use My Attendance to check in/out or see today's status.",
      "Open Attendance History to review past months.",
      "My Salary shows your salary structure; My Payslips lists the payslips generated from payroll runs (downloadable).",
      "My Profile lets you keep your contact details up to date.",
    ],
    tips: [
      "A staff account can only access these pages — try to open admin pages only if you are an admin.",
      "Contact the school admin if you cannot sign in; they can reset your password.",
    ],
    related: [
      { label: "Add staff login", href: "/dashboard/staff" },
      { label: "Payroll", href: "/dashboard/payroll" },
    ],
  },
  {
    id: "staff-settings",
    title: "Configure attendance timing settings",
    pageLabel: "Staff Settings",
    href: "/dashboard/staff/settings",
    keywords: [
      "settings", "attendance settings", "timings", "shift", "school timing",
      "daily hours", "working hours", "half day cutoff", "attendance timing",
    ],
    summary:
      "These settings define your school day — for example the daily start/end time and how many hours count as a working day — which attendance and payroll use.",
    steps: [
      "Open Settings (Owner/Admin only).",
      "Set the school day Start Time and End Time.",
      "Configure any working-hours rules (e.g. minimum hours for a full day, half-day threshold).",
      "Save — new attendance records will follow these timings.",
    ],
    tips: [
      "Wrong timings can mark everyone late or early, so double-check the values.",
      "Changes affect new records; existing saved days are not rewritten.",
    ],
    related: [
      { label: "Attendance", href: "/dashboard/attendance" },
      { label: "Payroll", href: "/dashboard/payroll" },
    ],
  },

  /* ------------- ACCOUNTING ------------- */
  {
    id: "chart-of-accounts",
    title: "Chart of Accounts (account list)",
    pageLabel: "Chart of Accounts",
    href: "/accounting/accounts",
    keywords: [
      "chart of accounts", "account", "account code", "account name",
      "asset", "liability", "equity", "income", "expense category",
      "cash account", "bank account", "add account",
    ],
    summary:
      "This is your accounting account list — Cash, Bank, Fee Receivable, Salary Payable and more. Every fee, payment and expense posts to one of these accounts.",
    steps: [
      "Use the Search box to find an account by name or code.",
      "To add one: enter an Account Code (e.g. 'EXP-001'), an Account Name (e.g. 'Electricity Expense') and pick the Account Type.",
      "Set the account Active/Inactive as needed.",
      "Your school already has built-in accounts (Cash, Bank, receivables, payables) — create new ones only when you need a new income/expense/asset head.",
    ],
    tips: [
      "Account Type decides how the account appears in reports (asset, liability, equity, income or expense).",
      "Fee collections and payments reference these accounts, so keep the code/name clean.",
    ],
    related: [
      { label: "Journal", href: "/accounting/journal" },
      { label: "Ledger", href: "/accounting/ledger" },
      { label: "Payment", href: "/accounting/payment" },
    ],
  },
  {
    id: "journal",
    title: "Record a journal entry",
    pageLabel: "Journal",
    href: "/accounting/journal",
    keywords: [
      "journal", "journal entry", "particulars", "debit", "credit",
      "reference", "double entry", "manual entry", "narration",
    ],
    summary:
      "The journal is where manual accounting entries are made. Every entry has debit lines, credit lines and a narration — the debits and credits must balance.",
    steps: [
      "Enter the Journal particulars (a narration — what this entry is about).",
      "Add the reference number if there is one (e.g. an invoice number).",
      "Add lines: for each, choose the account and enter the amount in Debit or Credit.",
      "Keep adding lines until the total debits equal the total credits (EduNexa keeps the running totals).",
      "Save the entry — it posts to the Ledger and reports automatically.",
    ],
    tips: [
      "If debit ≠ credit, the save is blocked — that's intentional double-entry protection.",
      "Use the narration as a searchable description of the transaction.",
    ],
    related: [
      { label: "Ledger", href: "/accounting/ledger" },
      { label: "Trial balance", href: "/accounting/trial-balance" },
      { label: "Chart of accounts", href: "/accounting/accounts" },
    ],
  },
  {
    id: "ledger",
    title: "View an account ledger",
    pageLabel: "Ledger",
    href: "/accounting/ledger",
    keywords: [
      "ledger", "account ledger", "ledger report", "view account",
      "opening balance", "account activity",
    ],
    summary:
      "The ledger shows every debit and credit that has hit one account, across the dates you choose — the running balance at the bottom is that account's current position.",
    steps: [
      "Pick the Account you want to inspect.",
      "Choose the date range (or financial year).",
      "Review the entries — each one shows the date, narration and debit/credit amount.",
      "Export to PDF/Excel or print when you need a copy for records.",
    ],
    tips: [
      "If a balance looks wrong, check the related journal/payment/receipt first.",
      "The ledger updates in real time after every posting.",
    ],
    related: [
      { label: "Journal", href: "/accounting/journal" },
      { label: "Trial balance", href: "/accounting/trial-balance" },
      { label: "Opening balance", href: "/accounting/opening-balance" },
    ],
  },
  {
    id: "opening-balance",
    title: "Set opening balances",
    pageLabel: "Opening Balance",
    href: "/accounting/opening-balance",
    keywords: [
      "opening balance", "beginning balance", "set balance", "previous year balance",
      "closing balance carry", "initial balance", "starting balance",
    ],
    summary:
      "Opening balances record what each account had at the start of a financial year — usually carried from the previous year's closing figures.",
    steps: [
      "Pick the Financial Year for which you are setting the opening balances.",
      "Choose the Account (Cash, Bank, receivables, payables, etc.).",
      "Enter the Amount, on the correct side — Debit for asset/cash-like accounts, Credit for liability/payable accounts.",
      "Add the opening date if the page asks for it.",
      "Save and repeat for every account that had a balance.",
    ],
    tips: [
      "Opening balances should match the previous year's closing balances for a continuous trail.",
      "Reports like Trial Balance use these as their starting point.",
    ],
    related: [
      { label: "Trial balance", href: "/accounting/trial-balance" },
      { label: "Ledger", href: "/accounting/ledger" },
      { label: "Balance sheet", href: "/accounting/balance-sheet" },
    ],
  },
  {
    id: "payment",
    title: "Make a payment (expense / salary)",
    pageLabel: "Payment",
    href: "/accounting/payment",
    keywords: [
      "payment", "make payment", "pay expense", "pay salary", "paid from",
      "expense payment", "vendor payment", "reference", "payroll payment",
      "money out",
    ],
    summary:
      "The Payment page records money going out — paying a vendor, settling an expense, or paying staff salaries. You always choose which Cash/Bank account the money leaves from.",
    steps: [
      "Choose the Payment Type: a normal expense payment, a specific expense, or Payroll (salary).",
      "For Payroll: select the Employee and the payroll run/month — the net amount is filled for you.",
      "Select Paid From: a Cash account for cash payments or a Bank account for bank/UPI/cheque.",
      "Enter the Amount and the Date.",
      "Add a Reference (e.g. invoice or 'PAYROLL-2026-06-EMP001') and Particulars/description.",
      "Save — a double-entry posting is created (expense/salary payable debited, cash/bank credited).",
    ],
    tips: [
      "Make sure the Paid From account type is Cash or Bank.",
      "Payroll payments automatically mark that employee's payroll item as paid and generate the payslip.",
    ],
    related: [
      { label: "Expenses", href: "/dashboard/expenses" },
      { label: "Payroll", href: "/dashboard/payroll" },
      { label: "Cash / Bank book", href: "/accounting/cash-bank" },
    ],
  },
  {
    id: "receipt",
    title: "Issue a receipt (money received)",
    pageLabel: "Receipt",
    href: "/accounting/receipt",
    keywords: [
      "receipt", "fee receipt", "collect money", "receive money",
      "receipt type", "student fee", "payment method", "receive into",
      "split cash bank", "print receipt",
    ],
    summary:
      "The Receipt page records money coming in. For student fees it reads the student's bill and lets you collect part or all of it, into Cash and/or Bank.",
    steps: [
      "Choose the Receipt Type — Student Fee (collect from a student's bill) or a general/other receipt.",
      "Pick the Receipt Date and the Payment Method (cash, bank transfer, UPI, cheque, card, etc.).",
      "For Student Fee: pick the Class/Grade → Section → Student, then select their bill.",
      "Choose Receive Into — the Cash or Bank account the money goes to. For split collections enter the Cash Amount and Bank/Online Amount separately.",
      "Enter the Amount being collected (and an optional note).",
      "Save and, if needed, print/download the receipt for the parent.",
    ],
    tips: [
      "Receipts update the student's fee balance and your Cash/Bank book automatically.",
      "Use one receipt per student to avoid mixing records.",
    ],
    related: [
      { label: "Student fees", href: "/dashboard/students/[id]/fees" },
      { label: "Record payment", href: "/dashboard/students/[id]/payment" },
      { label: "Cash / Bank book", href: "/accounting/cash-bank" },
    ],
  },
  {
    id: "cash-bank",
    title: "Cash Book & Bank Book",
    pageLabel: "Cash / Bank Book",
    href: "/accounting/cash-bank",
    keywords: [
      "cash book", "bank book", "cash bank", "transactions",
      "search transaction", "deposit", "withdrawal", "cash movements",
      "bank transactions",
    ],
    summary:
      "The Cash Book and Bank Book show every transaction that touched your Cash or Bank accounts — fee collections, payments, expenses and contra transfers.",
    steps: [
      "Use the menu to open either the Cash Book (?book=cash) or Bank Book (?book=bank).",
      "Browse the transaction list, or use the Search box to find a specific entry.",
      "Review the columns (date, description/particulars, debit, credit, balance).",
      "Every fee receipt, expense, payment and contra appears here automatically — no manual entry needed.",
    ],
    tips: [
      "If money is missing, check the Receipt and Payment pages first.",
      "The running balance should match your physical cash / bank statement — use Bank Reconciliation to cross-check.",
    ],
    related: [
      { label: "Receipt", href: "/accounting/receipt" },
      { label: "Payment", href: "/accounting/payment" },
      { label: "Bank reconciliation", href: "/accounting/bank-reconciliation" },
    ],
  },
  {
    id: "contra",
    title: "Record a contra (cash ↔ bank transfer)",
    pageLabel: "Contra",
    href: "/accounting/contra",
    keywords: [
      "contra", "transfer cash to bank", "transfer bank to cash",
      "contra entry", "deposit cash", "withdraw from bank", "bank deposit",
    ],
    summary:
      "A contra is a movement between your own accounts — depositing cash into the bank or withdrawing money from the bank into the cash drawer. Total money does not change.",
    steps: [
      "Select the account you are transferring From (Cash → Bank, or Bank → Cash).",
      "Select the account transferring To.",
      "Enter the Amount and a short description/narration (e.g. 'Cash deposited into bank').",
      "Add the deposit-slip / bank reference number if available.",
      "Save — one account is debited and the other is credited by the same amount.",
    ],
    tips: [
      "Use contra only for your own account transfers, not for payments to others (use Payment for that).",
      "Keeping reference numbers makes bank reconciliation quicker.",
    ],
    related: [
      { label: "Cash / Bank book", href: "/accounting/cash-bank" },
      { label: "Bank reconciliation", href: "/accounting/bank-reconciliation" },
      { label: "Journal", href: "/accounting/journal" },
    ],
  },
  {
    id: "reports",
    title: "Open the Reports hub",
    pageLabel: "Reports",
    href: "/dashboard/reports",
    keywords: [
      "reports", "report", "fee collection report", "attendance report",
      "payroll report", "expenses report", "export", "statement",
      "fee report", "download report",
    ],
    summary:
      "The Reports page groups ready-made reports for school management and accounting — fee collection, attendance, payroll, expenses and the full accounting statements.",
    steps: [
      "Choose a report group (School Management, Accounting, etc.).",
      "Click a card — e.g. Fee Collection, Staff Attendance, Staff Payroll or Expenses.",
      "On the report screen, pick filters like month, class or financial year.",
      "Export to PDF or Excel, or print, for sharing with the management/parents.",
    ],
    tips: [
      "Reports read live data, so keeping daily records up to date keeps reports accurate.",
      "Balance sheet, trial balance, ledger etc. are under the Accounting section.",
    ],
    related: [
      { label: "Balance sheet", href: "/accounting/balance-sheet" },
      { label: "Trial balance", href: "/accounting/trial-balance" },
      { label: "Expenses", href: "/dashboard/expenses" },
    ],
  },
  {
    id: "trial-balance",
    title: "View the Trial Balance",
    pageLabel: "Trial Balance",
    href: "/accounting/trial-balance",
    keywords: [
      "trial balance", "trial", "debit totals", "credit totals",
      "financial year", "trial balance report",
    ],
    summary:
      "The Trial Balance lists every account with its debit and credit totals for the period. When everything is posted correctly, total debits equal total credits.",
    steps: [
      "Pick the Financial Year (and period) at the top.",
      "Review the accounts with their debit and credit columns.",
      "Check the total row — if debits ≠ credits, look for an unbalanced journal or unposted entry.",
      "Export or print a copy for your accountant if needed.",
    ],
    tips: [
      "Unbalanced totals usually mean a journal entry is missing or mis-assigned.",
      "The Trial Balance is the foundation the Balance Sheet is built on.",
    ],
    related: [
      { label: "Ledger", href: "/accounting/ledger" },
      { label: "Balance sheet", href: "/accounting/balance-sheet" },
      { label: "Chart of accounts", href: "/accounting/accounts" },
    ],
  },
  {
    id: "balance-sheet",
    title: "Read the Balance Sheet",
    pageLabel: "Balance Sheet",
    href: "/accounting/balance-sheet",
    keywords: [
      "balance sheet", "assets", "liabilities", "equity",
      "financial position", "total assets", "balance sheet report",
    ],
    summary:
      "The Balance Sheet is a snapshot of your school's financial position: what it owns (Assets), owes (Liabilities) and the equity, across the financial year.",
    steps: [
      "Select the Financial Year (and as-on date if shown).",
      "Review the three sections: Assets, Liabilities, and Equity (including current profit/loss).",
      "Check that Total Assets = Total Liabilities + Equity.",
      "Print or export a PDF/Excel copy for records or audits.",
    ],
    tips: [
      "If it doesn't balance, check opening balances and the trial balance first.",
      "School name and address appear on the header — keep them updated on the School Setup page.",
    ],
    related: [
      { label: "Trial balance", href: "/accounting/trial-balance" },
      { label: "Profit & loss", href: "/accounting/profit-loss" },
      { label: "Opening balance", href: "/accounting/opening-balance" },
    ],
  },
  {
    id: "profit-loss",
    title: "View Profit & Loss",
    pageLabel: "Profit & Loss",
    href: "/accounting/profit-loss",
    keywords: [
      "profit", "loss", "income", "expense", "profit and loss",
      "p and l", "net profit", "net loss", "p&l statement",
    ],
    summary:
      "The Profit & Loss statement groups your income and expenses for the period and shows whether the school made a surplus (profit) or deficit (loss).",
    steps: [
      "Pick the Financial Year / period.",
      "Review the Income section (fee collections, other income) and the Expense section.",
      "The Net Profit or Net Loss is the difference — profit when income exceeds expenses.",
      "Export to PDF/Excel for review or audits.",
    ],
    tips: [
      "Fees collected show under income; salaries and expenses under expenses.",
      "A 'loss' isn't an error — it just means expenses were higher than income in that period.",
    ],
    related: [
      { label: "Balance sheet", href: "/accounting/balance-sheet" },
      { label: "Expenses", href: "/dashboard/expenses" },
      { label: "Receipt", href: "/accounting/receipt" },
    ],
  },
  {
    id: "bank-reconciliation",
    title: "Reconcile the bank book",
    pageLabel: "Bank Reconciliation",
    href: "/accounting/bank-reconciliation",
    keywords: [
      "bank reconciliation", "reconciliation", "bank statement",
      "closing balance", "match transactions", "statement balance",
      "reconcile bank",
    ],
    summary:
      "Bank Reconciliation helps you make sure the Bank Book in EduNexa matches your real bank account. You enter the bank statement's closing balance and compare entries.",
    steps: [
      "Open Bank Reconciliation and pick the account + period.",
      "Enter the Bank Statement Closing Balance shown on your real bank statement.",
      "Compare the list of entries with your statement; mark entries as cleared/checked as you verify them.",
      "Check the difference — it should drop to zero once every entry is verified and no transactions are missing.",
      "Save the reconciliation once it matches.",
    ],
    tips: [
      "A difference usually means a missing fee deposit or an unrecorded bank charge.",
      "Record bank charges as expenses so the book stays accurate.",
    ],
    related: [
      { label: "Cash / Bank book", href: "/accounting/cash-bank" },
      { label: "Receipt", href: "/accounting/receipt" },
      { label: "Payment", href: "/accounting/payment" },
    ],
  },
];

/* =========================================================
   MATCHING ENGINE
   ========================================================= */

function scoreGuide(
  guide: ChatGuide,
  queryTokens: string[],
  currentPage: string,
): number {
  if (queryTokens.length === 0) return 0;

  const flat = new Set<string>();
  for (const keyword of guide.keywords) {
    for (const word of tokenize(keyword)) flat.add(word);
  }

  let score = 0;
  for (const token of queryTokens) {
    if (flat.has(token)) {
      score += 4;
    } else {
      for (const candidate of flat) {
        if (candidate.length >= 4 && candidate.includes(token)) {
          score += 1;
          break;
        }
      }
    }
  }

  // Phrase bonus: a multi-word keyword fully inside the query.
  const queryText = normalize(queryTokens.join(" "));
  for (const keyword of guide.keywords) {
    const parts = tokenize(keyword);
    if (parts.length >= 2) {
      const phrase = normalize(parts.join(" "));
      if (queryText.includes(phrase) || phrase.includes(queryText)) {
        score += 5;
      }
    }
  }

  // Context boost: the user is already on this page.
  const strippedPage = stripPath(currentPage);
  if (guide.href === strippedPage) score += 6;
  else if (
    strippedPage.length > 1 &&
    (strippedPage.startsWith(`${guide.href}/`) ||
      guide.href.startsWith(`${strippedPage}/`))
  ) {
    score += 2;
  }

  return score;
}

function findBestGuide(message: string, page: string): ChatGuide | null {
  const queryTokens = tokenize(message);
  if (queryTokens.length === 0) return null;

  let best: ChatGuide | null = null;
  let bestScore = 0;

  for (const guide of GUIDES) {
    const score = scoreGuide(guide, queryTokens, page);
    if (score > bestScore) {
      best = guide;
      bestScore = score;
    }
  }

  return bestScore >= 4 ? best : null;
}

function guideToAnswer(guide: ChatGuide): ChatAnswer {
  return {
    kind: "guide",
    text: guide.summary,
    title: guide.title,
    pageLabel: guide.pageLabel,
    href: guide.href,
    steps: guide.steps,
    tips: guide.tips,
    related: guide.related,
  };
}

/* =========================================================
   SMALL TALK
   ========================================================= */

const WELCOME_TEXT =
  "Hi! I'm the EduNexa Assistant. 👋 I know every page in EduNexa and can walk you through any task step by step — what to enter, what each field is for, and what happens after you save. Try asking a question like 'How do I add a student?'";

const CAPABILITIES: ChatAnswer = {
  kind: "smalltalk",
  text:
    "I can guide you through everything in EduNexa with clear, step-by-step instructions. For example:",
  steps: [
    "'How do I add a student?' — all the fields explained in order.",
    "'What to enter in the admission form?' — field-by-field guidance.",
    "'How do I collect fees?' — payment modes, cash/bank split and receipts.",
    "'How do I run payroll?' — attendance → salary → payment flow.",
    "'What is a journal / contra / ledger?' — plain-language accounting help.",
  ],
  tips: [
    "I'm context-aware: if you ask from a page, I answer for that page first.",
  ],
};

function detectSmalltalk(raw: string): ChatAnswer | null {
  const text = normalize(raw);

  const greetings = [
    /^(hi|hii|hiii|hello|hey|namaste|namaskar)\b/,
    /^good\s+(morning|afternoon|evening|day)\b/,
    /^(yo|sup|wassup|howdy)\b/,
  ];
  if (greetings.some((pattern) => pattern.test(text))) {
    return { kind: "smalltalk", text: WELCOME_TEXT };
  }

  if (
    /(thanks|thank you|thx|great|awesome|perfect|got it|ok cool)/.test(text)
  ) {
    return {
      kind: "smalltalk",
      text: "You're welcome! 😊 Happy to help with anything else — just ask.",
    };
  }

  if (/\b(bye|goodbye|see you|cya)\b/.test(text)) {
    return {
      kind: "smalltalk",
      text: "Goodbye! 👋 If you need help later, just open this chat again.",
    };
  }

  if (
    /(who are you|what can you do|what do you do|help me|how do i use this|features|what is edunexa|about you)/.test(
      text,
    )
  ) {
    return CAPABILITIES;
  }

  return null;
}

/* =========================================================
   PUBLIC API
   ========================================================= */

const FALLBACK_SUGGESTIONS = [
  "How do I add a student?",
  "How do I collect fees?",
  "How do I run payroll?",
];

/**
 * Build the full assistant answer for a user message.
 */
export function buildAnswer(message: string, page: string): ChatAnswer {
  const smalltalk = detectSmalltalk(message);
  if (smalltalk) return smalltalk;

  const guide = findBestGuide(message, page);
  if (guide) return guideToAnswer(guide);

  return {
    kind: "fallback",
    text: "I couldn't find a guide matching that yet. Could you rephrase it? For example ask:",
    steps: [
      "'What do I enter to add a new student?'",
      "'How do I record a fee payment?'",
      "'How do I run payroll for a month?'",
      "'What is a balance sheet?'",
    ],
    tips: [
      "Tip: ask what you are trying to do, and I'll show the exact page and steps.",
    ],
  };
}

/**
 * Suggested questions relevant to the page the user is on.
 */
export function suggestionsForPage(page: string): string[] {
  const stripped = stripPath(page);

  const menu: Array<[string, string[]]> = [
    ["/dashboard/students", ["How do I add a student?", "How do I promote students?", "How do I collect a fee?"]],
    ["/dashboard/students/new", ["What do I enter in every field?", "What happens after I save?", "How do I set the Admission Fee?"]],
    ["/dashboard/classes", ["How do I add a section?", "How do I create a new class?"]],
    ["/dashboard/academic-years", ["How do I set the current year?", "What dates do I enter?"]],
    ["/dashboard/fees/structure", ["How do I create a fee category?", "What does frequency mean?", "How do I assign fees to a class?"]],
    ["/dashboard/attendance", ["How do I mark attendance?", "What do P, A, H, W/O mean?"]],
    ["/dashboard/expenses", ["What fields do I fill?", "How do I add a vendor?"]],
    ["/dashboard/staff", ["How do I add a staff member?", "How do I reset a staff password?"]],
    ["/dashboard/staff/new", ["What do I enter in every field?", "How do I create a staff login?"]],
    ["/dashboard/payroll", ["How do I run payroll?", "Why is LOP showing?", "How do I pay salaries?"]],
    ["/accounting/journal", ["What is a journal entry?", "How do I add debit and credit lines?"]],
    ["/accounting/payment", ["How do I record an expense payment?", "How do I pay salary?"]],
    ["/accounting/receipt", ["How do I collect fees here?", "What should I enter?"]],
    ["/accounting/cash-bank", ["What is a cash book?", "Where is my bank balance?"]],
    ["/accounting/trial-balance", ["What should this total?", "Why don't debits equal credits?"]],
    ["/accounting/balance-sheet", ["How do I read this report?", "Why doesn't it balance?"]],
    ["/accounting/bank-reconciliation", ["How do I reconcile my bank account?"]],
  ];

  for (const [path, items] of menu) {
    if (stripped === path || (path.length > 1 && stripped.startsWith(`${path}/`))) {
      return items;
    }
  }

  // Fall back to the guide that owns the current page.
  for (const guide of GUIDES) {
    if (stripped === guide.href) {
      return [
        guide.title.startsWith("Add")
          ? "What do I enter on this page?"
          : `How do I use the ${guide.pageLabel} page?`,
        ...FALLBACK_SUGGESTIONS.slice(0, 2),
      ];
    }
  }

  return FALLBACK_SUGGESTIONS;
}

/**
 * Default welcome suggestions for the conversation start.
 */
export function defaultSuggestions(): string[] {
  return [
    "What do I need to set up first?",
    "How do I add a student?",
    "How do I collect fees?",
    "How do I run payroll?",
  ];
}