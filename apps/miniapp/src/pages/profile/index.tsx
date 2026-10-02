import { useEffect, useState } from "react";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { navigateBack } from "@tarojs/taro";

import { getProfile, saveProfile } from "../../api";
import { DEFAULT_PROFILE_FORM_VALUES, prepareProfileSubmission, type FieldErrors } from "./profile-form";

export default function ProfilePage(): JSX.Element {
  const [preferredAreas, setPreferredAreas] = useState(DEFAULT_PROFILE_FORM_VALUES.preferredAreas);
  const [availableTimes, setAvailableTimes] = useState(DEFAULT_PROFILE_FORM_VALUES.availableTimes);
  const [tastePreferences, setTastePreferences] = useState(DEFAULT_PROFILE_FORM_VALUES.tastePreferences);
  const [dietaryRestrictions, setDietaryRestrictions] = useState(DEFAULT_PROFILE_FORM_VALUES.dietaryRestrictions);
  const [budgetRange, setBudgetRange] = useState(DEFAULT_PROFILE_FORM_VALUES.budgetRange);
  const [tableVibe, setTableVibe] = useState(DEFAULT_PROFILE_FORM_VALUES.tableVibe);
  const [tableSizes, setTableSizes] = useState(DEFAULT_PROFILE_FORM_VALUES.tableSizes);
  const [note, setNote] = useState(DEFAULT_PROFILE_FORM_VALUES.note);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      const profile = await getProfile();
      if (!profile) return;
      setPreferredAreas(profile.preferredAreas.join("，"));
      setAvailableTimes(profile.availableTimes.join("，"));
      setTastePreferences(profile.tastePreferences.join("，"));
      setDietaryRestrictions(profile.dietaryRestrictions.join("，"));
      setBudgetRange(profile.budgetRange);
      setTableVibe(profile.tableVibe);
      setTableSizes(profile.acceptableTableSizes.join(", "));
      setNote(profile.note ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "问卷加载失败");
    }
  }

  function clearFieldError(field: keyof FieldErrors): void {
    setFieldErrors((current) => {
      const { [field]: _removed, ...remaining } = current;
      return remaining;
    });
  }

  async function submit(): Promise<void> {
    const submission = prepareProfileSubmission({ preferredAreas, availableTimes, tastePreferences, dietaryRestrictions, budgetRange, tableVibe, tableSizes, note });
    if ("fieldErrors" in submission) {
      setFieldErrors(submission.fieldErrors);
      setError("");
      return;
    }
    try {
      setBusy(true);
      setError("");
      setFieldErrors({});
      await saveProfile(submission.payload);
      setMessage("偏好已保存，仅用于运营人工排桌参考。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "问卷保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="page page-profile">
      <View className="detail-header">
        <Text className="eyebrow">TABLE NOTE</Text>
        <Text className="title">饭局偏好问卷</Text>
        <Text className="summary">仅用于运营人工排桌参考，不展示给其他用户，也不用于自动匹配。</Text>
      </View>
      {error ? <Text className="error-text">错误：{error}</Text> : null}
      {message ? <Text className="success-text">{message}</Text> : null}
      <View className="detail-block">
        <Text className="block-title">基本偏好</Text>
        <Text className="form-label">常去区域 *</Text>
        <Input className="report-input" value={preferredAreas} maxlength={200} onInput={(event) => { setPreferredAreas(event.detail.value); clearFieldError("preferredAreas"); }} placeholder="例如：徐汇，静安" />
        {fieldErrors.preferredAreas ? <Text className="field-error">{fieldErrors.preferredAreas}</Text> : null}
        <Text className="form-label">方便时间 *</Text>
        <Input className="report-input" value={availableTimes} maxlength={200} onInput={(event) => { setAvailableTimes(event.detail.value); clearFieldError("availableTimes"); }} placeholder="例如：周六晚，周日下午" />
        {fieldErrors.availableTimes ? <Text className="field-error">{fieldErrors.availableTimes}</Text> : null}
        <Text className="form-label">口味偏好</Text>
        <Input className="report-input" value={tastePreferences} maxlength={300} onInput={(event) => setTastePreferences(event.detail.value)} placeholder="例如：本帮菜，日料" />
        <Text className="form-label">饮食限制 *</Text>
        <Input className="report-input" value={dietaryRestrictions} maxlength={300} onInput={(event) => { setDietaryRestrictions(event.detail.value); clearFieldError("dietaryRestrictions"); }} placeholder="无也请填写“无”" />
        {fieldErrors.dietaryRestrictions ? <Text className="field-error">{fieldErrors.dietaryRestrictions}</Text> : null}
      </View>
      <View className="detail-block">
        <Text className="block-title">同桌安排</Text>
        <Text className="form-label">餐费预算 *</Text>
        <Input className="report-input" value={budgetRange} maxlength={40} onInput={(event) => { setBudgetRange(event.detail.value); clearFieldError("budgetRange"); }} placeholder="例如：150-250" />
        {fieldErrors.budgetRange ? <Text className="field-error">{fieldErrors.budgetRange}</Text> : null}
        <Text className="form-label">饭局氛围 *</Text>
        <Input className="report-input" value={tableVibe} maxlength={80} onInput={(event) => { setTableVibe(event.detail.value); clearFieldError("tableVibe"); }} placeholder="例如：轻松聊天" />
        {fieldErrors.tableVibe ? <Text className="field-error">{fieldErrors.tableVibe}</Text> : null}
        <Text className="form-label">可接受桌位人数 *</Text>
        <Input className="report-input" value={tableSizes} maxlength={30} onInput={(event) => { setTableSizes(event.detail.value); clearFieldError("tableSizes"); }} placeholder="仅限 4 至 8，例如：4，6" />
        {fieldErrors.tableSizes ? <Text className="field-error">{fieldErrors.tableSizes}</Text> : null}
        <Text className="form-label">补充说明</Text>
        <Textarea className="report-textarea" value={note} maxlength={500} onInput={(event) => setNote(event.detail.value)} placeholder="可选：仅填写与排桌有关的说明" />
      </View>
      <View className="action-bar">
        <Button className="button-primary" disabled={busy} onClick={() => void submit()}>{busy ? "保存中…" : "保存偏好"}</Button>
        <Button className="button-secondary" onClick={() => navigateBack()}>返回</Button>
      </View>
    </View>
  );
}
