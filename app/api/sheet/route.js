// 서버사이드에서 Google Sheets CSV를 가져오는 API
// 클라이언트 → /api/sheet → Google Sheets (CORS 우회)

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toCSVUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.includes("output=csv") || trimmed.includes("/pub?")) return trimmed;
  const editMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (editMatch) {
    const id = editMatch[1];
    const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  }
  return trimmed;
}

export async function GET(request) {
  // 환경변수에 시트 URL이 설정되어 있으면 그걸 사용 (보안: URL 노출 방지)
  const envUrl = process.env.SHEET_URL;
  // 그게 없으면 쿼리 파라미터로도 받을 수 있게 (개발/테스트용)
  const { searchParams } = new URL(request.url);
  const queryUrl = searchParams.get("url");

  const targetUrl = envUrl || queryUrl;
  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: "시트 URL이 설정되지 않았습니다. Vercel 환경변수 SHEET_URL을 등록해주세요." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const csvUrl = toCSVUrl(targetUrl);
    const res = await fetch(csvUrl, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `시트 접근 실패 (HTTP ${res.status}). 공유 설정을 확인해주세요.` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const text = await res.text();

    if (text.trim().toLowerCase().startsWith("<!doctype html") || text.includes("<html")) {
      return new Response(
        JSON.stringify({ error: "시트가 비공개 상태입니다. '링크가 있는 모든 사용자' 뷰어 권한으로 변경해주세요." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || "데이터를 불러오지 못했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
