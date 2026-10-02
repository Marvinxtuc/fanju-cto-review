import type { UserProfileInput } from "../../api";

export interface ProfileFormValues {
  preferredAreas: string;
  availableTimes: string;
  tastePreferences: string;
  dietaryRestrictions: string;
  budgetRange: string;
  tableVibe: string;
  tableSizes: string;
  note: string;
}

export type ProfileField = "preferredAreas" | "availableTimes" | "dietaryRestrictions" | "budgetRange" | "tableVibe" | "tableSizes";
export type FieldErrors = Partial<Record<ProfileField, string>>;

export const DEFAULT_PROFILE_FORM_VALUES: ProfileFormValues = {
  preferredAreas: "",
  availableTimes: "",
  tastePreferences: "",
  dietaryRestrictions: "无",
  budgetRange: "",
  tableVibe: "",
  tableSizes: "4, 6",
  note: "",
};

function splitValues(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

export function prepareProfileSubmission(values: ProfileFormValues): { payload: UserProfileInput } | { fieldErrors: FieldErrors } {
  const payload: UserProfileInput = {
    preferredAreas: splitValues(values.preferredAreas),
    availableTimes: splitValues(values.availableTimes),
    tastePreferences: splitValues(values.tastePreferences),
    dietaryRestrictions: splitValues(values.dietaryRestrictions),
    budgetRange: values.budgetRange.trim(),
    tableVibe: values.tableVibe.trim(),
    acceptableTableSizes: splitValues(values.tableSizes).map(Number).filter((size) => Number.isInteger(size) && size >= 4 && size <= 8),
    ...(values.note.trim() ? { note: values.note.trim() } : {}),
  };
  const fieldErrors: FieldErrors = {
    ...(!payload.preferredAreas.length ? { preferredAreas: "请至少填写一个常去区域" } : {}),
    ...(!payload.availableTimes.length ? { availableTimes: "请至少填写一个方便时间" } : {}),
    ...(!payload.dietaryRestrictions.length ? { dietaryRestrictions: "请填写饮食限制；无也请填写“无”" } : {}),
    ...(!payload.budgetRange ? { budgetRange: "请填写餐费预算" } : {}),
    ...(!payload.tableVibe ? { tableVibe: "请填写饭局氛围" } : {}),
    ...(!payload.acceptableTableSizes.length ? { tableSizes: "请填写 4 至 8 人的可接受桌位人数" } : {}),
  };

  return Object.keys(fieldErrors).length ? { fieldErrors } : { payload };
}
