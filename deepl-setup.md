# DeepL Translator Setup

## 1. Get a DeepL API key

- Sign in to DeepL and create an API key.
- If you are on the free DeepL API plan, that key normally works with the `api-free.deepl.com` endpoint automatically.

## 2. Update your notes table

- Open the SQL editor in Supabase.
- Run the contents of [supabase-schema.sql](C:\Users\wildc\Documents\Vibe\test app\supabase-schema.sql) again.
- This adds the translation columns if they are missing.

## 3. Add your DeepL key to Supabase secrets

- In Supabase, open `Edge Functions`.
- Find the project secrets area.
- Add a secret called `DEEPL_API_KEY`.
- Paste your DeepL API key as the value.

## 4. Deploy the Edge Function

- Install the Supabase CLI if you do not already have it.
- From this project folder, log in and link your project if needed.
- Deploy the function with:

```powershell
supabase functions deploy translate-note
```

## 5. Test the app

- Refresh the sticky notes page.
- Type English in the top half of a note and check the bottom half becomes Brazilian Portuguese.
- Type Brazilian Portuguese and check the bottom half becomes English.
