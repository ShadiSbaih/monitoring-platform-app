# Clerk setup for the landing page

The app uses live Clerk authentication when both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set in `.env`.

In the Clerk Dashboard for the matching Clerk application:

1. Enable email sign-up and sign-in under **User & authentication**.
2. Enable Google under **SSO connections**.
3. Enable **Organizations** so users can create and switch organizations from the navbar.
4. Copy the development instance's publishable and secret keys into `apps/landing-page/.env`.

Until those keys are configured, `/sign-in` and `/sign-up` use a local demo flow. It stores only a demo name, email, and organization list in this browser's local storage; it does not authenticate against Clerk or persist data to a server. The legacy `/waitlist` route redirects to `/sign-up`.
