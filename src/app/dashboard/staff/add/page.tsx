import { redirect } from "next/navigation";

export default function AddStaffRedirect() {
  redirect("/dashboard/staff/new");
}
