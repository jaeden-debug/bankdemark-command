import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import EditProfilePanel from '@/components/command/EditProfilePanel';

export const metadata: Metadata = {
  title: 'Edit Profile | BankDeMark Command',
  robots: { index: false },
};

export default function ProfilePage() {
  return (
    <CommandShell requiresAuth>
      <EditProfilePanel />
    </CommandShell>
  );
}
