import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL")!;

const SUPABASE_SECRET_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function response(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    }
  );
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function validPassword(
  password: string
) {
  return password.length >= 8;
}

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return response(
      {
        error:
          "Only POST requests are allowed.",
      },
      405
    );
  }

  try {

    // --------------------------------------------------------
    // 1. VERIFY LOGGED-IN USER
    // --------------------------------------------------------

    const authHeader =
      req.headers.get("Authorization");

    if (!authHeader) {
      return response(
        {
          error:
            "Authentication required.",
        },
        401
      );
    }

    const token =
      authHeader.replace(
        "Bearer ",
        ""
      );

    const {
      data: {
        user,
      },
      error: userError,
    } =
      await admin.auth.getUser(token);

    if (
      userError ||
      !user
    ) {
      return response(
        {
          error:
            "Invalid authentication.",
        },
        401
      );
    }


    // --------------------------------------------------------
    // 2. VERIFY SUPER ADMIN
    // --------------------------------------------------------

    const {
      data: profile,
      error: profileError,
    } =
      await admin
        .from("user_profiles")
        .select(
          "platform_role,is_active"
        )
        .eq("id", user.id)
        .maybeSingle();

    if (
      profileError ||
      !profile
    ) {
      return response(
        {
          error:
            "User profile not found.",
        },
        403
      );
    }

    if (
      profile.platform_role !==
        "super_admin" ||
      profile.is_active !== true
    ) {
      return response(
        {
          error:
            "Only Super Admin can create schools.",
        },
        403
      );
    }


    // --------------------------------------------------------
    // 3. READ REQUEST
    // --------------------------------------------------------

    const body =
      await req.json();


    const schoolName =
      clean(body.schoolName);

    const schoolCode =
      clean(body.schoolCode)
        .toUpperCase();

    const ownerName =
      clean(body.ownerName);

    const phone =
      clean(body.phone);

    const contactEmail =
      clean(body.contactEmail);

    const planCode =
      clean(body.planCode)
        .toLowerCase();

    const amount =
      Number(body.amount || 0);

    const studentLimit =
      Number(
        body.studentLimit || 300
      );

    const startsOn =
      clean(body.startsOn);

    const expiresOn =
      clean(body.expiresOn);

    const password =
      clean(body.password);


    // --------------------------------------------------------
    // 4. VALIDATION
    // --------------------------------------------------------

    if (!schoolName) {
      return response(
        {
          error:
            "School name is required.",
        },
        400
      );
    }

    if (!schoolCode) {
      return response(
        {
          error:
            "School ID is required.",
        },
        400
      );
    }

    if (
      !/^[A-Z0-9_-]{3,30}$/.test(
        schoolCode
      )
    ) {
      return response(
        {
          error:
            "School ID may contain only letters, numbers, underscore and hyphen.",
        },
        400
      );
    }

    if (!ownerName) {
      return response(
        {
          error:
            "Owner name is required.",
        },
        400
      );
    }

    if (!phone) {
      return response(
        {
          error:
            "Phone number is required.",
        },
        400
      );
    }

    if (!validPassword(password)) {
      return response(
        {
          error:
            "Password must contain at least 8 characters.",
        },
        400
      );
    }

    if (
      !Number.isInteger(
        studentLimit
      ) ||
      studentLimit < 1
    ) {
      return response(
        {
          error:
            "Student limit is invalid.",
        },
        400
      );
    }

    if (!startsOn || !expiresOn) {
      return response(
        {
          error:
            "Start and expiry dates are required.",
        },
        400
      );
    }


    // --------------------------------------------------------
    // 5. CHECK SCHOOL CODE
    // --------------------------------------------------------

    const {
      data: existingSchool,
      error: existingSchoolError,
    } =
      await admin
        .from("schools")
        .select("id")
        .ilike(
          "school_code",
          schoolCode
        )
        .maybeSingle();

    if (existingSchoolError) {
      throw existingSchoolError;
    }

    if (existingSchool) {
      return response(
        {
          error:
            "This School ID already exists.",
        },
        409
      );
    }


    // --------------------------------------------------------
    // 6. INTERNAL AUTH EMAIL
    //
    // This is NOT the customer's real email.
    // It is only used by Supabase Auth.
    //
    // School owner logs in with:
    //
    // School ID + Password
    //
    // The frontend resolves School ID to this internal email.
    // --------------------------------------------------------

    const internalAuthEmail =
      `${schoolCode.toLowerCase()}@login.schoolerp.local`;


    // --------------------------------------------------------
    // 7. CREATE SCHOOL
    // --------------------------------------------------------

    const {
      data: school,
      error: schoolError,
    } =
      await admin
        .from("schools")
        .insert({
          name: schoolName,
          school_code:
            schoolCode,
          contact_phone:
            phone,
          contact_email:
            contactEmail ||
            null,
          student_limit:
            studentLimit,
          plan_code:
            planCode ||
            "starter",
          starts_on:
            startsOn,
          expires_on:
            expiresOn,
          status:
            "active",
          created_by:
            user.id,
        })
        .select("id,name,school_code")
        .single();

    if (schoolError) {
      throw schoolError;
    }


    // --------------------------------------------------------
    // 8. CREATE OWNER AUTH USER
    // --------------------------------------------------------

    const {
      data: authResult,
      error: authError,
    } =
      await admin.auth.admin.createUser({
        email:
          internalAuthEmail,

        password,

        email_confirm:
          true,

        user_metadata: {
          full_name:
            ownerName,

          school_code:
            schoolCode,
        },

        app_metadata: {
          account_type:
            "school_owner",
        },
      });

    if (
      authError ||
      !authResult.user
    ) {

      // Roll back school
      await admin
        .from("schools")
        .delete()
        .eq(
          "id",
          school.id
        );

      throw (
        authError ??
        new Error(
          "Unable to create owner."
        )
      );
    }


    const ownerId =
      authResult.user.id;


    // --------------------------------------------------------
    // 9. CREATE USER PROFILE
    // --------------------------------------------------------

    const {
      error: profileInsertError,
    } =
      await admin
        .from("user_profiles")
        .insert({
          id: ownerId,
          full_name:
            ownerName,
          login_id:
            schoolCode,
          phone,
          platform_role:
            "user",
          is_active:
            true,
        });

    if (profileInsertError) {

      await admin.auth.admin.deleteUser(
        ownerId
      );

      await admin
        .from("schools")
        .delete()
        .eq(
          "id",
          school.id
        );

      throw profileInsertError;
    }


    // --------------------------------------------------------
    // 10. ADD OWNER TO SCHOOL
    // --------------------------------------------------------

    const {
      error: membershipError,
    } =
      await admin
        .from("school_users")
        .insert({
          user_id:
            ownerId,

          school_id:
            school.id,

          role:
            "owner",

          is_active:
            true,
        });

    if (membershipError) {

      await admin
        .from("user_profiles")
        .delete()
        .eq(
          "id",
          ownerId
        );

      await admin.auth.admin.deleteUser(
        ownerId
      );

      await admin
        .from("schools")
        .delete()
        .eq(
          "id",
          school.id
        );

      throw membershipError;
    }


    // --------------------------------------------------------
    // 11. CREATE SUBSCRIPTION
    // --------------------------------------------------------

    const {
      error: subscriptionError,
    } =
      await admin
        .from(
          "school_subscriptions"
        )
        .insert({
          school_id:
            school.id,

          plan_code:
            planCode ||
            "starter",

          status:
            "active",

          amount:
            amount,

          started_on:
            startsOn,

          expires_on:
            expiresOn,

          student_limit:
            studentLimit,

          created_by:
            user.id,
        });

    if (subscriptionError) {

      // Keep school creation recoverable.
      // Log it instead of deleting the already
      // created school and owner.

      console.error(
        "Subscription creation failed:",
        subscriptionError
      );

      return response(
        {
          success: true,

          warning:
            "School and owner were created, but subscription creation failed.",

          schoolId:
            school.id,

          schoolCode:
            schoolCode,

          ownerName:
            ownerName,

          loginId:
            schoolCode,

          temporaryPassword:
            password,
        },
        201
      );
    }


    // --------------------------------------------------------
    // 12. SUCCESS
    // --------------------------------------------------------

    return response(
      {
        success: true,

        schoolId:
          school.id,

        schoolCode:
          schoolCode,

        schoolName:
          schoolName,

        ownerName:
          ownerName,

        loginId:
          schoolCode,

        temporaryPassword:
          password,

        expiresOn:
          expiresOn,
      },
      201
    );

  } catch (error) {

    console.error(error);

    return response(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create school.",
      },
      500
    );
  }
});