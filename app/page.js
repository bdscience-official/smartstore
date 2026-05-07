"use client";

import React, { useState, useMemo, useEffect } from "react";
import { ComposedChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, MousePointerClick, Wallet, ShoppingBag, CircleDollarSign, Filter, Check, X, RefreshCw, AlertCircle, Database } from "lucide-react";
import Papa from "papaparse";

// ===== 채널그룹 → 유입유형 매핑 =====
// 광고유입: 검색광고, 광고, 메신저, 사용자정의
// 오가닉유입: 검색, 기타, 소셜, 쇼핑, 웹사이트, 일반유입
const ORGANIC_GROUPS = ["검색", "기타", "소셜", "쇼핑", "웹사이트", "일반유입"];
const AD_GROUPS = ["검색광고", "광고", "메신저", "사용자정의"];
const inflowType = (group) =>
  ORGANIC_GROUPS.includes(group) ? "오가닉유입" :
  AD_GROUPS.includes(group) ? "광고유입" : "기타";

// ===== 사용하는 컬럼 (raw에 추가 컬럼이 있어도 무시) =====
const REQUIRED_COLS = {
  date: "날짜",
  attr: "채널속성",
  group: "채널그룹",
  name: "채널명",
  detail: "채널상세",
  visits: "유입수",
  adCost: "광고비",
  orders: "결제수(마지막클릭)",
  revenue: "결제금액(마지막클릭)",
};

const fmt = {
  num: (n) => new Intl.NumberFormat("ko-KR").format(Math.round(n || 0)),
  won: (n) => "₩" + new Intl.NumberFormat("ko-KR").format(Math.round(n || 0)),
  pct: (n) => (n == null || !isFinite(n)) ? "—" : (n * 100).toFixed(1) + "%",
  short: (n) => {
    if (n == null) return "—";
    if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1) + "억";
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + "만";
    return new Intl.NumberFormat("ko-KR").format(Math.round(n));
  },
  date: (d) => {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  },
  shortDate: (d) => {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  },
};

function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof v === "string") {
    let s = v.trim();
    s = s.replace(/\./g, "-").replace(/\//g, "-");
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function weekStart(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return dt;
}

function monthStart(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), 1);
}

export default function Dashboard() {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [lastFetched, setLastFetched] = useState(null);

  const dimensions = ["attr", "inflow", "group", "name", "detail"];
  const dimLabel = { attr: "채널속성", inflow: "유입유형", group: "채널그룹", name: "채널명", detail: "채널상세" };

  const [activeDims, setActiveDims] = useState({ attr: true, inflow: true, group: true, name: false, detail: false });
  const [filters, setFilters] = useState({ attr: new Set(), inflow: new Set(), group: new Set(), name: new Set(), detail: new Set() });
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [granularity, setGranularity] = useState("auto");

  const fetchData = async () => {
    setLoading(true);
    setError("");
    setWarning("");
    try {
      const res = await fetch("/api/sheet", { cache: "no-store" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `데이터 로드 실패 (HTTP ${res.status})`);
      }
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
      if (parsed.errors.length > 0) {
        const first = parsed.errors[0];
        if (first.code !== "TooFewFields") throw new Error(`CSV 파싱 오류: ${first.message}`);
      }

      // 헤더 확인
      const headers = parsed.meta.fields || [];
      const missing = Object.values(REQUIRED_COLS).filter(c => !headers.includes(c));
      if (missing.length > 0) {
        throw new Error(`시트에 필수 컬럼이 없습니다: ${missing.join(", ")}`);
      }

      const rows = [];
      let invalidCount = 0;
      for (const r of parsed.data) {
        const date = parseDate(r[REQUIRED_COLS.date]);
        const attr = r[REQUIRED_COLS.attr];
        const group = r[REQUIRED_COLS.group];
        const name = r[REQUIRED_COLS.name];
        if (!date || !attr || !group || !name) { invalidCount++; continue; }
        rows.push({
          date,
          attr: String(attr).trim(),
          group: String(group).trim(),
          inflow: inflowType(String(group).trim()),
          name: String(name).trim(),
          detail: r[REQUIRED_COLS.detail] ? String(r[REQUIRED_COLS.detail]).trim() : "-",
          visits: Number(r[REQUIRED_COLS.visits]) || 0,
          adCost: Number(r[REQUIRED_COLS.adCost]) || 0,
          orders: Number(r[REQUIRED_COLS.orders]) || 0,
          revenue: Number(r[REQUIRED_COLS.revenue]) || 0,
        });
      }
      if (rows.length === 0) {
        throw new Error("유효한 데이터 행이 없습니다. 시트 데이터를 확인해주세요.");
      }
      setAllRows(rows);
      setLastFetched(new Date());

      // 첫 로드 시 또는 날짜 범위가 비어있으면 전체 기간으로 자동 설정
      if (!dateRange.start || !dateRange.end) {
        const dates = rows.map(r => r.date.getTime());
        setDateRange({
          start: fmt.date(new Date(Math.min(...dates))),
          end: fmt.date(new Date(Math.max(...dates))),
        });
      }
      if (invalidCount > 0) {
        setWarning(`${rows.length}행 로드 완료. (필수 값 누락 ${invalidCount}행 제외)`);
      }
    } catch (e) {
      setError(e.message || "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 페이지 진입 시 자동 로드
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uniqueValues = useMemo(() => {
    const u = { attr: new Set(), inflow: new Set(), group: new Set(), name: new Set(), detail: new Set() };
    allRows.forEach(r => dimensions.forEach(d => u[d].add(r[d])));
    return Object.fromEntries(Object.entries(u).map(([k, v]) => [k, [...v].sort()]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows]);

  const filteredData = useMemo(() => {
    const startMs = dateRange.start ? new Date(dateRange.start + "T00:00:00").getTime() : -Infinity;
    const endMs = dateRange.end ? new Date(dateRange.end + "T23:59:59").getTime() : Infinity;
    return allRows.filter(r => {
      const t = r.date.getTime();
      if (t < startMs || t > endMs) return false;
      for (const d of dimensions) {
        if (filters[d].size > 0 && !filters[d].has(r[d])) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filters, dateRange]);

  const totals = useMemo(() => {
    const t = { visits: 0, adCost: 0, orders: 0, revenue: 0, adVisits: 0, adOrders: 0, adRevenue: 0, orgVisits: 0, orgOrders: 0, orgRevenue: 0 };
    filteredData.forEach(r => {
      t.visits += r.visits; t.adCost += r.adCost; t.orders += r.orders; t.revenue += r.revenue;
      if (r.inflow === "광고유입") { t.adVisits += r.visits; t.adOrders += r.orders; t.adRevenue += r.revenue; }
      else if (r.inflow === "오가닉유입") { t.orgVisits += r.visits; t.orgOrders += r.orders; t.orgRevenue += r.revenue; }
    });
    t.roas = t.adCost > 0 ? t.revenue / t.adCost : null;
    t.cvr = t.visits > 0 ? t.orders / t.visits : null;
    t.aov = t.orders > 0 ? t.revenue / t.orders : null;
    return t;
  }, [filteredData]);

  const effectiveGranularity = useMemo(() => {
    if (granularity !== "auto") return granularity;
    if (!dateRange.start || !dateRange.end) return "day";
    const days = (new Date(dateRange.end) - new Date(dateRange.start)) / (1000 * 60 * 60 * 24) + 1;
    if (days <= 14) return "day";
    if (days <= 60) return "week";
    return "month";
  }, [granularity, dateRange]);

  const trendData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const buckets = new Map();
    for (const r of filteredData) {
      let bucketDate;
      if (effectiveGranularity === "day") bucketDate = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate());
      else if (effectiveGranularity === "week") bucketDate = weekStart(r.date);
      else bucketDate = monthStart(r.date);
      const key = bucketDate.getTime();
      if (!buckets.has(key)) buckets.set(key, {
        date: bucketDate, key,
        광고유입: 0, 오가닉유입: 0,
        광고결제수: 0, 오가닉결제수: 0,
        광고매출: 0, 오가닉매출: 0,
        광고비: 0,
      });
      const b = buckets.get(key);
      if (r.inflow === "광고유입") {
        b.광고유입 += r.visits; b.광고결제수 += r.orders; b.광고매출 += r.revenue; b.광고비 += r.adCost;
      } else if (r.inflow === "오가닉유입") {
        b.오가닉유입 += r.visits; b.오가닉결제수 += r.orders; b.오가닉매출 += r.revenue;
      }
    }
    const sorted = [...buckets.values()].sort((a, b) => a.key - b.key);
    return sorted.map(b => ({
      ...b,
      label: effectiveGranularity === "month"
        ? `${b.date.getFullYear()}.${String(b.date.getMonth() + 1).padStart(2, "0")}`
        : effectiveGranularity === "week"
        ? `${b.date.getMonth() + 1}/${b.date.getDate()}~`
        : fmt.shortDate(b.date),
      총유입: b.광고유입 + b.오가닉유입,
      총결제: b.광고결제수 + b.오가닉결제수,
      총매출: b.광고매출 + b.오가닉매출,
    }));
  }, [filteredData, effectiveGranularity]);

  const groupBreakdown = useMemo(() => {
    const map = new Map();
    filteredData.forEach(r => {
      const parts = [];
      if (activeDims.attr) parts.push(r.attr);
      if (activeDims.inflow) parts.push(r.inflow);
      if (activeDims.group) parts.push(r.group);
      if (activeDims.name) parts.push(r.name);
      if (activeDims.detail) parts.push(r.detail);
      const key = parts.length > 0 ? parts.join("|") : "전체";
      if (!map.has(key)) map.set(key, { key, label: parts.join(" · ") || "전체", visits: 0, adCost: 0, orders: 0, revenue: 0, isAd: r.inflow === "광고유입" });
      const e = map.get(key);
      e.visits += r.visits; e.adCost += r.adCost; e.orders += r.orders; e.revenue += r.revenue;
    });
    return [...map.values()].map(e => ({
      ...e,
      cvr: e.visits > 0 ? e.orders / e.visits : 0,
      roas: e.adCost > 0 ? e.revenue / e.adCost : null,
      aov: e.orders > 0 ? e.revenue / e.orders : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredData, activeDims]);

  const trendGrowth = useMemo(() => {
    if (trendData.length < 2) return null;
    const first = trendData[0], last = trendData[trendData.length - 1];
    const calc = (a, b) => a > 0 ? (b - a) / a : null;
    return {
      org: calc(first.오가닉유입, last.오가닉유입),
      ad: calc(first.광고유입, last.광고유입),
      orgRev: calc(first.오가닉매출, last.오가닉매출),
      totRev: calc(first.총매출, last.총매출),
    };
  }, [trendData]);

  const toggleFilter = (dim, val) => setFilters(f => {
    const s = new Set(f[dim]);
    if (s.has(val)) s.delete(val); else s.add(val);
    return { ...f, [dim]: s };
  });
  const clearFilter = (dim) => setFilters(f => ({ ...f, [dim]: new Set() }));
  const toggleDim = (dim) => setActiveDims(d => ({ ...d, [dim]: !d[dim] }));

  const adShare = totals.visits > 0 ? totals.adVisits / totals.visits : 0;
  const orgShare = totals.visits > 0 ? totals.orgVisits / totals.visits : 0;
  const adRevShare = totals.revenue > 0 ? totals.adRevenue / totals.revenue : 0;
  const orgRevShare = totals.revenue > 0 ? totals.orgRevenue / totals.revenue : 0;
  const hasData = allRows.length > 0;

  return (
    <div className="min-h-screen text-stone-100" style={{ background: "radial-gradient(ellipse at top, #1a1f1c 0%, #0a0d0b 70%)" }}>
      <div className="max-w-[1400px] mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between border-b border-stone-700/40 pb-6">
          <div>
            <div className="text-xs tracking-[0.3em] text-lime-400/70 mb-2 font-mono-kr">SMARTSTORE · INFLOW DASHBOARD</div>
            <h1 className="font-display text-5xl text-stone-50">스마트스토어 유입 대시보드</h1>
            <div className="text-stone-400 text-sm mt-2">광고 vs 오가닉 성과를 한눈에</div>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="text-stone-100 bg-lime-400/10 hover:bg-lime-400/20 border border-lime-400/40 flex items-center gap-2 px-4 py-2 transition disabled:opacity-50 text-sm"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "동기화 중..." : "새로고침"}
          </button>
        </div>

        {error && (
          <div className="mb-6 text-sm px-4 py-3 border border-rose-500/40 bg-rose-500/5 text-rose-300 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {warning && (
          <div className="mb-6 text-xs px-4 py-2 border border-amber-500/40 bg-amber-500/5 text-amber-300 flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{warning}</span>
          </div>
        )}

        {!hasData && loading ? (
          <div className="text-center py-20 text-stone-400">
            <RefreshCw size={32} className="mx-auto mb-4 animate-spin text-lime-400" />
            <div>데이터 불러오는 중...</div>
          </div>
        ) : !hasData ? (
          <div className="text-center py-20 text-stone-500">
            <Database size={48} className="mx-auto mb-4 opacity-30" />
            <div className="text-lg">데이터가 없습니다</div>
            <div className="text-xs mt-2">Vercel 환경변수 SHEET_URL을 확인하고 새로고침해주세요</div>
          </div>
        ) : (
          <>
            {lastFetched && (
              <div className="mb-4 text-[10px] text-stone-500 font-mono-kr text-right">
                마지막 동기화: {fmt.date(lastFetched)} {String(lastFetched.getHours()).padStart(2, "0")}:{String(lastFetched.getMinutes()).padStart(2, "0")} · {fmt.num(allRows.length)}행
              </div>
            )}

            {/* Date range + granularity */}
            <div className="mb-6 bg-stone-900/40 border border-stone-700/40 px-5 py-4 flex items-center gap-6 flex-wrap">
              <span className="font-mono-kr text-xs tracking-widest text-stone-300">조회 기간</span>
              <div className="flex items-center gap-2">
                <input type="date" value={dateRange.start} onChange={(e) => setDateRange(r => ({ ...r, start: e.target.value }))}
                  className="bg-stone-800/60 border border-stone-700 px-3 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-lime-400" />
                <span className="text-stone-500">~</span>
                <input type="date" value={dateRange.end} onChange={(e) => setDateRange(r => ({ ...r, end: e.target.value }))}
                  className="bg-stone-800/60 border border-stone-700 px-3 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-lime-400" />
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <span className="font-mono-kr text-xs tracking-widest text-stone-500">집계 단위</span>
                <div className="flex border border-stone-700">
                  {[["auto", "자동"], ["day", "일간"], ["week", "주간"], ["month", "월간"]].map(([v, l]) => (
                    <button key={v} onClick={() => setGranularity(v)}
                      className={`px-3 py-1.5 text-xs transition ${granularity === v ? "bg-lime-400 text-stone-900 font-bold" : "text-stone-400 hover:text-stone-100"}`}>
                      {l}
                    </button>
                  ))}
                </div>
                {granularity === "auto" && <span className="text-[10px] text-stone-500 font-mono-kr">→ {effectiveGranularity === "day" ? "일" : effectiveGranularity === "week" ? "주" : "월"}간</span>}
              </div>
            </div>

            {/* Filter Panel */}
            <div className="mb-8 bg-stone-900/40 border border-stone-700/40">
              <div className="px-5 py-3 border-b border-stone-700/40 flex items-center gap-2">
                <Filter size={14} className="text-lime-400" />
                <span className="font-mono-kr text-xs tracking-widest text-stone-300">VIEW BY</span>
                <span className="text-stone-600 text-xs ml-2">집계 기준 선택 (체크) · 각 컬럼 안에서 항목 클릭 시 필터링</span>
              </div>
              <div className="grid grid-cols-5 divide-x divide-stone-700/40">
                {dimensions.map(dim => (
                  <div key={dim} className="p-4">
                    <label className="flex items-center gap-2 cursor-pointer mb-3 group" onClick={() => toggleDim(dim)}>
                      <div className={`w-4 h-4 border flex items-center justify-center transition flex-shrink-0 ${activeDims[dim] ? "bg-lime-400 border-lime-400" : "border-stone-600 group-hover:border-stone-400"}`}>
                        {activeDims[dim] && <Check size={12} className="text-stone-900" strokeWidth={3} />}
                      </div>
                      <span className={`font-display text-sm ${activeDims[dim] ? "text-lime-300" : "text-stone-300"}`}>{dimLabel[dim]}</span>
                    </label>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {uniqueValues[dim]?.map(v => (
                        <button key={v} onClick={() => toggleFilter(dim, v)}
                          className={`block w-full text-left text-xs px-2 py-1 transition truncate ${filters[dim].has(v) ? "bg-lime-400/10 text-lime-300 border-l-2 border-lime-400" : "text-stone-400 hover:text-stone-200 hover:bg-stone-800/40 border-l-2 border-transparent"}`}>
                          {v === "-" ? "(없음)" : v}
                        </button>
                      ))}
                    </div>
                    {filters[dim].size > 0 && (
                      <button onClick={() => clearFilter(dim)} className="mt-2 text-[10px] font-mono-kr text-stone-500 hover:text-stone-300 flex items-center gap-1">
                        <X size={10} /> 초기화 ({filters[dim].size})
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <KpiCard icon={MousePointerClick} label="유입수" value={fmt.num(totals.visits)} sub={`광고 ${fmt.short(totals.adVisits)} · 오가닉 ${fmt.short(totals.orgVisits)}`} />
              <KpiCard icon={Wallet} label="광고비" value={fmt.won(totals.adCost)} sub={`ROAS ${totals.roas ? totals.roas.toFixed(2) + "x" : "—"}`} />
              <KpiCard icon={ShoppingBag} label="결제수" value={fmt.num(totals.orders)} sub={`전환율 ${fmt.pct(totals.cvr)}`} />
              <KpiCard icon={CircleDollarSign} label="결제금액" value={fmt.won(totals.revenue)} sub={`객단가 ${fmt.won(totals.aov)}`} />
            </div>

            {/* Ad vs Organic + Trend */}
            <div className="grid grid-cols-12 gap-4 mb-8">
              <div className="col-span-4 bg-stone-900/40 border border-stone-700/40 p-6 relative grain overflow-hidden">
                <div className="font-mono-kr text-[10px] tracking-[0.25em] text-stone-500 mb-1">AD ⇄ ORGANIC</div>
                <h3 className="font-display text-2xl text-stone-100 mb-5">광고 vs 오가닉</h3>
                <div className="space-y-5">
                  <SplitBar label="유입수" leftPct={adShare} rightPct={orgShare} leftVal={fmt.short(totals.adVisits)} rightVal={fmt.short(totals.orgVisits)} />
                  <SplitBar label="결제수" leftPct={totals.orders > 0 ? totals.adOrders / totals.orders : 0} rightPct={totals.orders > 0 ? totals.orgOrders / totals.orders : 0} leftVal={fmt.num(totals.adOrders)} rightVal={fmt.num(totals.orgOrders)} />
                  <SplitBar label="결제금액" leftPct={adRevShare} rightPct={orgRevShare} leftVal={fmt.short(totals.adRevenue)} rightVal={fmt.short(totals.orgRevenue)} />
                </div>
                {trendGrowth && (
                  <div className="mt-6 pt-5 border-t border-stone-700/40">
                    <div className="font-mono-kr text-[10px] tracking-[0.25em] text-stone-500 mb-3">기간 내 첫 ↔ 마지막 포인트 성장률</div>
                    <div className="grid grid-cols-2 gap-3">
                      <GrowthPill label="오가닉 유입" value={trendGrowth.org} />
                      <GrowthPill label="총 매출" value={trendGrowth.totRev} />
                      <GrowthPill label="광고 유입" value={trendGrowth.ad} />
                      <GrowthPill label="오가닉 매출" value={trendGrowth.orgRev} />
                    </div>
                  </div>
                )}
              </div>

              <div className="col-span-8 bg-stone-900/40 border border-stone-700/40 p-6">
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <div className="font-mono-kr text-[10px] tracking-[0.25em] text-stone-500 mb-1">INFLOW TREND</div>
                    <h3 className="font-display text-2xl text-stone-100">유입 추이 <span className="text-stone-500 text-xs">({effectiveGranularity === "day" ? "일간" : effectiveGranularity === "week" ? "주간" : "월간"} · {trendData.length}개 포인트)</span></h3>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <Legend2 color="#a3e635" label="광고 유입" />
                    <Legend2 color="#78716c" label="오가닉 유입" />
                    <Legend2 color="#fbbf24" label="총 매출" dashed />
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#44403c" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" stroke="#a8a29e" style={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" stroke="#a8a29e" style={{ fontSize: 11 }} tickFormatter={fmt.short} />
                    <YAxis yAxisId="right" orientation="right" stroke="#fbbf24" style={{ fontSize: 11 }} tickFormatter={fmt.short} />
                    <Tooltip contentStyle={{ background: "#1c1917", border: "1px solid #44403c", fontSize: 12 }} formatter={(v, n) => n.includes("매출") ? fmt.won(v) : fmt.num(v)} />
                    <Bar yAxisId="left" dataKey="광고유입" stackId="a" fill="#a3e635" />
                    <Bar yAxisId="left" dataKey="오가닉유입" stackId="a" fill="#78716c" />
                    <Line yAxisId="right" type="monotone" dataKey="총매출" stroke="#fbbf24" strokeWidth={2} dot={{ fill: "#fbbf24", r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Revenue & Orders Trend */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-stone-900/40 border border-stone-700/40 p-6">
                <div className="font-mono-kr text-[10px] tracking-[0.25em] text-stone-500 mb-1">REVENUE</div>
                <h3 className="font-display text-xl text-stone-100 mb-4">매출 추이</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid stroke="#44403c" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" stroke="#a8a29e" style={{ fontSize: 11 }} />
                    <YAxis stroke="#a8a29e" style={{ fontSize: 11 }} tickFormatter={fmt.short} />
                    <Tooltip contentStyle={{ background: "#1c1917", border: "1px solid #44403c", fontSize: 12 }} formatter={(v) => fmt.won(v)} />
                    <Line type="monotone" dataKey="광고매출" stroke="#a3e635" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="오가닉매출" stroke="#fbbf24" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-stone-900/40 border border-stone-700/40 p-6">
                <div className="font-mono-kr text-[10px] tracking-[0.25em] text-stone-500 mb-1">ORDERS</div>
                <h3 className="font-display text-xl text-stone-100 mb-4">결제수 추이</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid stroke="#44403c" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" stroke="#a8a29e" style={{ fontSize: 11 }} />
                    <YAxis stroke="#a8a29e" style={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1c1917", border: "1px solid #44403c", fontSize: 12 }} formatter={(v) => fmt.num(v)} />
                    <Line type="monotone" dataKey="광고결제수" stroke="#a3e635" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="오가닉결제수" stroke="#fbbf24" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Detailed table */}
            <div className="bg-stone-900/40 border border-stone-700/40">
              <div className="px-5 py-4 border-b border-stone-700/40 flex items-center justify-between">
                <div>
                  <div className="font-mono-kr text-[10px] tracking-[0.25em] text-stone-500 mb-1">BREAKDOWN</div>
                  <h3 className="font-display text-xl text-stone-100">채널별 상세 <span className="text-stone-500 text-sm">({groupBreakdown.length}개)</span></h3>
                </div>
                <div className="text-xs text-stone-500 font-mono-kr">
                  집계 기준: {dimensions.filter(d => activeDims[d]).map(d => dimLabel[d]).join(" · ") || "전체"}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] tracking-[0.2em] text-stone-500 font-mono-kr border-b border-stone-700/40">
                      <th className="px-5 py-3">CHANNEL</th>
                      <th className="px-3 py-3 text-right">유입수</th>
                      <th className="px-3 py-3 text-right">광고비</th>
                      <th className="px-3 py-3 text-right">결제수</th>
                      <th className="px-3 py-3 text-right">결제금액</th>
                      <th className="px-3 py-3 text-right">전환율</th>
                      <th className="px-3 py-3 text-right">ROAS</th>
                      <th className="px-3 py-3 text-right">객단가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupBreakdown.slice(0, 30).map((r) => (
                      <tr key={r.key} className="border-b border-stone-800/60 hover:bg-stone-800/20 transition">
                        <td className="px-5 py-3 text-stone-200">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${r.isAd ? "bg-lime-400" : "bg-stone-500"}`}></span>
                            <span className="truncate max-w-[400px]">{r.label || "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono-kr">{fmt.num(r.visits)}</td>
                        <td className="px-3 py-3 text-right font-mono-kr text-stone-400">{r.adCost > 0 ? fmt.won(r.adCost) : "—"}</td>
                        <td className="px-3 py-3 text-right font-mono-kr">{fmt.num(r.orders)}</td>
                        <td className="px-3 py-3 text-right font-mono-kr text-lime-300">{fmt.won(r.revenue)}</td>
                        <td className="px-3 py-3 text-right font-mono-kr text-stone-400">{fmt.pct(r.cvr)}</td>
                        <td className="px-3 py-3 text-right font-mono-kr text-stone-400">{r.roas ? r.roas.toFixed(2) + "x" : "—"}</td>
                        <td className="px-3 py-3 text-right font-mono-kr text-stone-400">{r.aov > 0 ? fmt.won(r.aov) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {groupBreakdown.length > 30 && (
                  <div className="px-5 py-3 text-xs text-stone-500 text-center border-t border-stone-800/60">상위 30개만 표시 · 전체 {groupBreakdown.length}개</div>
                )}
              </div>
            </div>

            <div className="mt-10 pt-6 border-t border-stone-800 text-[10px] font-mono-kr text-stone-600 tracking-widest text-center">
              LAST CLICK ATTRIBUTION · GOOGLE SHEETS LIVE SYNC
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-stone-900/40 border border-stone-700/40 p-5 hover:border-stone-600 transition">
      <div className="flex items-start justify-between mb-3">
        <span className="text-stone-300 text-sm">{label}</span>
        <Icon size={16} className="text-lime-400" />
      </div>
      <div className="font-display text-3xl text-stone-50">{value}</div>
      <div className="text-[11px] text-stone-500 mt-1 font-mono-kr">{sub}</div>
    </div>
  );
}

function SplitBar({ label, leftPct, rightPct, leftVal, rightVal }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs text-stone-400">{label}</span>
        <span className="text-[10px] font-mono-kr text-stone-500">{(leftPct * 100).toFixed(0)} / {(rightPct * 100).toFixed(0)}</span>
      </div>
      <div className="flex h-7 bg-stone-800/60">
        <div className="bg-lime-400 flex items-center justify-start px-2 transition-all" style={{ width: `${leftPct * 100}%` }}>
          <span className="text-[10px] font-mono-kr text-stone-900 font-bold whitespace-nowrap">{leftVal}</span>
        </div>
        <div className="bg-stone-600 flex items-center justify-end px-2 transition-all" style={{ width: `${rightPct * 100}%` }}>
          <span className="text-[10px] font-mono-kr text-stone-100 whitespace-nowrap">{rightVal}</span>
        </div>
      </div>
    </div>
  );
}

function GrowthPill({ label, value }) {
  if (value == null) return (
    <div className="border border-stone-700/40 px-3 py-2">
      <div className="text-[10px] text-stone-500 mb-0.5">{label}</div>
      <div className="text-stone-500 text-sm">—</div>
    </div>
  );
  const pos = value >= 0;
  return (
    <div className="border border-stone-700/40 px-3 py-2">
      <div className="text-[10px] text-stone-500 mb-0.5">{label}</div>
      <div className={`text-sm font-mono-kr flex items-center gap-1 ${pos ? "text-lime-400" : "text-rose-400"}`}>
        {pos ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {pos ? "+" : ""}{(value * 100).toFixed(1)}%
      </div>
    </div>
  );
}

function Legend2({ color, label, dashed }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-3 ${dashed ? "h-0.5 border-t border-dashed" : "h-2"}`} style={{ background: dashed ? "transparent" : color, borderColor: dashed ? color : "transparent" }}></span>
      <span className="text-stone-400">{label}</span>
    </div>
  );
}
