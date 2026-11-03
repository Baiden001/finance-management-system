import DocumentsClient from '@/components/DocumentsClient';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Documents' };
export default function Page() { return <DocumentsClient />; }
