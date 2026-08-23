"use client";

import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const ResetPasswordForm = dynamic(
  () => import('../../components/ResetPasswordForm'),
  { 
    ssr: false,
    loading: () => <div>Loading...</div>
  }
);

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}