// Local simulation presentation options; never an admission or table-allocation condition.
export const timePreferenceOptions = [
 {code:'WEEKDAY_LUNCH',label:'工作日午餐'}, {code:'WEEKDAY_DINNER',label:'工作日晚餐'},
 {code:'WEEKEND_LUNCH',label:'周末午餐'}, {code:'WEEKEND_DINNER',label:'周末晚餐'},
] as const;
export function activityTimeSlot(startsAt: Date): string | null {
 if(!Number.isFinite(startsAt.getTime()))return null;
 const shanghai=new Date(startsAt.getTime()+8*3600_000),day=shanghai.getUTCDay(),hour=shanghai.getUTCHours();
 const meal=hour>=11&&hour<15?'LUNCH':hour>=17&&hour<22?'DINNER':null;
 return meal?`${day===0||day===6?'WEEKEND':'WEEKDAY'}_${meal}`:null;
}
export function matchesTimePreference(startsAt:Date,preferences:string[]):boolean {
 const slot=activityTimeSlot(startsAt);return slot!==null&&preferences.includes(slot);
}
export function summarizeTimePreferences(profiles:Array<{availableTimes:string[]}>) {
 const recognized=new Set<string>(timePreferenceOptions.map(p=>p.code));
 return {scope:'SIMULATION_ONLY',timezone:'Asia/Shanghai',profileCount:profiles.length,
 emptyPreferenceCount:profiles.filter(p=>p.availableTimes.length===0).length,
 unrecognizedPreferenceProfileCount:profiles.filter(p=>p.availableTimes.some(v=>!recognized.has(v))).length,
 slots:timePreferenceOptions.map(option=>({...option,count:profiles.filter(p=>p.availableTimes.includes(option.code)).length}))};
}
