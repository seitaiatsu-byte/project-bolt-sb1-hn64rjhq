export const CLINIC_FULL = {
  takatsuki: '高槻あつ整体院',
  kawanishi: '川西あつ整体院',
} as const;

export type ClinicFullName = (typeof CLINIC_FULL)[keyof typeof CLINIC_FULL];

export const CLINIC_OPTIONS: { value: ClinicFullName; label: string; short: string; color: 'blue' | 'orange' }[] = [
  { value: CLINIC_FULL.takatsuki, label: '高槻あつ整体院', short: '高槻', color: 'blue' },
  { value: CLINIC_FULL.kawanishi, label: '川西あつ整体院', short: '川西', color: 'orange' },
];

export function clinicMatchesRecord(
  clinicFilter: 'all' | 'takatsuki' | 'kawanishi',
  recordClinic: string | null | undefined
): boolean {
  if (clinicFilter === 'all') return true;
  const v = recordClinic || '';
  if (clinicFilter === 'takatsuki') {
    return v.includes('高槻');
  }
  return v.includes('川西');
}

export function customerMatchesClinic(
  clinicFilter: 'all' | 'takatsuki' | 'kawanishi',
  customerClinic: string | null | undefined
): boolean {
  if (clinicFilter === 'all') return true;
  const v = customerClinic || '';
  if (clinicFilter === 'takatsuki') return v.includes('高槻');
  return v.includes('川西');
}
