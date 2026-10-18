import { redirect } from 'next/navigation';
export default function Page() { redirect((process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3001') + '/sign-in'); }
