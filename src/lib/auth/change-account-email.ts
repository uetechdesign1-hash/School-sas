export type AccountEmailChange =
  | { target_type: "self"; email: string }
  | { target_type: "staff"; email: string; staff_id: string }
  | { target_type: "principal"; email: string; school_id: string };

type ChangeEmailResponse = {
  success?: unknown;
  error?: unknown;
  warning?: unknown;
  linked?: unknown;
};

export async function changeAccountEmail(
  accessToken: string,
  requestBody: AccountEmailChange,
): Promise<{ warning: string; linked: boolean | undefined }> {
  const response = await fetch("/api/auth/change-email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const result: unknown = await response.json();

  if (typeof result !== "object" || result === null) {
    throw new Error("Invalid response while updating the email.");
  }

  const data = result as ChangeEmailResponse;
  if (!response.ok || data.success !== true) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Unable to update the email.",
    );
  }

  return {
    warning: typeof data.warning === "string" ? data.warning : "",
    linked: typeof data.linked === "boolean" ? data.linked : undefined,
  };
}
