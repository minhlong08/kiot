import { Field, NumberInput } from '../../components/Field';
import { useSettingsSection } from '../settings/useSettingsForm';
import { RolesSettings } from '../settings/RolesSettings';

/** Attendance rules plus the role/permission matrix (shared with Thiết lập › Vai trò). */
export function StaffSettingsPage() {
  const { value, patch, save, saving } = useSettingsSection('staff');
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Thiết lập nhân viên</h1>
      {value && <div className="card max-w-3xl space-y-4 p-5">
        <h2 className="font-semibold">Quy định chấm công</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Cho phép đi muộn (phút)"><NumberInput value={value.lateGraceMinutes} onChange={v => patch({ lateGraceMinutes: v })} /></Field>
          <Field label="Cho phép về sớm (phút)"><NumberInput value={value.earlyGraceMinutes} onChange={v => patch({ earlyGraceMinutes: v })} /></Field>
          <Field label="Tính làm thêm sau (phút)"><NumberInput value={value.overtimeAfterMinutes} onChange={v => patch({ overtimeAfterMinutes: v })} /></Field>
          <Field label="Ngày công chuẩn / tháng"><NumberInput value={value.standardDays} onChange={v => patch({ standardDays: Math.max(1, Math.min(31, v)) })} /></Field>
        </div>
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
      </div>}
      <div className="card p-5"><h2 className="mb-3 font-semibold">Vai trò & phân quyền</h2><RolesSettings /></div>
    </div>
  );
}
