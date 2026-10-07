# School logo uploads with Cloudinary

School logo uploads use Cloudinary's unsigned image upload API. The application only stores the returned HTTPS delivery URL in `schools.logo_url`.

**No Cloudinary API key or API secret is needed for this flow.** The browser only needs the Cloud Name and the name of a restricted unsigned upload preset. Never put an API secret in a `NEXT_PUBLIC_` variable or browser code.

## 1. Create a restricted upload preset

In the Cloudinary Console, open **Settings → Upload → Upload presets** and create an **unsigned** preset for this application.

Recommended preset restrictions:

- Asset type: **Image**
- Allowed formats: **PNG, JPG/JPEG, WebP**
- Folder: **school-logos** (if the account uses fixed folders)
- Enable unique filenames and disallow public IDs if those options are available
- Apply an incoming transformation to limit stored image dimensions if desired

The page checks file format and limits normal uploads to **2 MB**. Cloudinary does not enforce a per-preset maximum file size for unsigned uploads, so this browser check is not a hard security limit. Unsigned preset names are public in browser code; restrict the preset to images and allowed formats. For server-enforced upload authorization or file-size limits, use a signed upload route and keep Cloudinary credentials on the server.

## 2. Configure the app

Set these public environment variables in the local environment and the production deployment:

```env
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your_unsigned_preset_name
```

Restart the Next.js server after changing local environment variables. The upload controls remain disabled until both values are configured.

## 3. Apply the database migration

Apply `supabase/migrations/20261007120000_school_logo_cloudinary.sql` to the Supabase project. It adds `schools.logo_url` and a database function that only permits active school owners and administrators to save a Cloudinary URL for their own school.

## Logo image guidance shown to schools

- Recommended: **512 × 512 px** square, or **512 × 256 px** horizontal
- Transparent PNG is a good choice; JPG and WebP are supported
- Maximum size: **2 MB**
- Keep text and important artwork away from the edges
