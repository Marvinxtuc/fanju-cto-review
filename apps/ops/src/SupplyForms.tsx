import { useState } from "react";
import { createActivity, saveRestaurant, type ActivityInput, type OpsRestaurant, type RestaurantInput } from "./api.js";

function value(form: FormData, key: string): string { return String(form.get(key) ?? "").trim(); }
function money(form: FormData, key: string): number { return Math.round(Number(value(form, key)) * 100); }
function integer(form: FormData, key: string): number { return Number(value(form, key)); }

export function RestaurantForm({ token, onSaved, restaurant }: { token: string; onSaved: () => Promise<void>; restaurant?: OpsRestaurant | undefined }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="ops-panel supply-form" key={restaurant?.id ?? "new"} onSubmit={event => { event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: RestaurantInput = {
      name: value(form, "name"), district: value(form, "district"), businessArea: value(form, "businessArea"),
      address: value(form, "address"), contactName: value(form, "contactName"), contactPhone: value(form, "contactPhone"),
      budgetCents: money(form, "budget"), cuisineTags: value(form, "cuisineTags").split(/[,，]/).map(x => x.trim()).filter(Boolean),
      capacity: integer(form, "capacity"),
    };
    setBusy(true); setError("");
    void saveRestaurant(token, input, restaurant?.id).then(onSaved).catch(e => setError(e instanceof Error ? e.message : "餐厅保存失败")).finally(() => setBusy(false));
  }}>
    <h3>{restaurant ? `编辑 ${restaurant.name}` : "新增餐厅"}</h3>
    <div className="supply-grid">
      <label>餐厅名称<input name="name" required defaultValue={restaurant?.name} /></label>
      <label>行政区<input name="district" required defaultValue={restaurant?.district} /></label>
      <label>商圈<input name="businessArea" required defaultValue={restaurant?.businessArea} /></label>
      <label>地址<input name="address" required defaultValue={restaurant?.address} /></label>
      <label>联系人<input name="contactName" required defaultValue={restaurant?.contactName} /></label>
      <label>联系电话<input name="contactPhone" type="tel" pattern="[+]?[0-9]{8,15}" required defaultValue={restaurant?.contactPhone} /></label>
      <label>人均预算（元）<input name="budget" type="number" min="0.01" step="0.01" required defaultValue={restaurant ? restaurant.budgetCents / 100 : undefined} /></label>
      <label>容量<input name="capacity" type="number" min="4" step="1" required defaultValue={restaurant?.capacity} /></label>
      <label>菜系标签，逗号分隔<input name="cuisineTags" defaultValue={restaurant?.cuisineTags.join("，")} /></label>
    </div>
    <button className="ops-button ops-button--primary" disabled={busy} type="submit">{busy ? "保存中…" : "保存餐厅"}</button>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}

export function ActivityForm({ token, restaurants, onSaved }: { token: string; restaurants: OpsRestaurant[]; onSaved: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="ops-panel supply-form" onSubmit={event => { event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: ActivityInput = {
      restaurantId: value(form, "restaurantId"), title: value(form, "title"), theme: value(form, "theme"),
      description: value(form, "description"), district: value(form, "district"), businessArea: value(form, "businessArea"),
      startsAt: new Date(value(form, "startsAt")).toISOString(), endsAt: new Date(value(form, "endsAt")).toISOString(),
      registrationEndsAt: new Date(value(form, "registrationEndsAt")).toISOString(), serviceFeeCents: money(form, "serviceFee"),
      mealFeeIncluded: false, mealFeePolicyText: value(form, "mealFeePolicyText"), minSize: integer(form, "minSize"),
      targetSize: integer(form, "targetSize"), maxSize: integer(form, "maxSize"), capacity: integer(form, "capacity"), status: "DRAFT",
    };
    setBusy(true); setError("");
    void createActivity(token, input).then(onSaved).catch(e => setError(e instanceof Error ? e.message : "活动创建失败")).finally(() => setBusy(false));
  }}>
    <h3>新增活动草稿</h3>
    <div className="supply-grid">
      <label>餐厅<select name="restaurantId" required><option value="">选择餐厅</option>{restaurants.map(r => <option key={r.id} value={r.id}>{r.name} · {r.capacity} 人</option>)}</select></label>
      <label>标题<input name="title" required /></label><label>主题<input name="theme" required /></label>
      <label>简介<input name="description" required /></label><label>行政区<input name="district" required /></label>
      <label>商圈<input name="businessArea" required /></label>
      <label>报名截止<input name="registrationEndsAt" type="datetime-local" required /></label>
      <label>开始时间<input name="startsAt" type="datetime-local" required /></label>
      <label>结束时间<input name="endsAt" type="datetime-local" required /></label>
      <label>服务费（元）<input name="serviceFee" type="number" min="0.01" step="0.01" required /></label>
      <label>餐费说明<input name="mealFeePolicyText" required defaultValue="服务费不含餐费，餐费到店自理。" /></label>
      <label>最少人数<input name="minSize" type="number" min="4" step="1" required defaultValue="4" /></label>
      <label>目标人数<input name="targetSize" type="number" min="4" step="1" required defaultValue="6" /></label>
      <label>最多人数<input name="maxSize" type="number" min="4" step="1" required defaultValue="8" /></label>
      <label>容量<input name="capacity" type="number" min="4" step="1" required defaultValue="8" /></label>
    </div>
    <button className="ops-button ops-button--primary" disabled={busy || restaurants.length === 0} type="submit">{busy ? "创建中…" : "创建草稿"}</button>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
