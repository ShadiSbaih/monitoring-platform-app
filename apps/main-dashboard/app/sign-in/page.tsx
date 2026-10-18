import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
export default function Page() { return <Suspense fallback={<p>Loading...</p>}><AuthForm mode="sign-in" /></Suspense>; }
