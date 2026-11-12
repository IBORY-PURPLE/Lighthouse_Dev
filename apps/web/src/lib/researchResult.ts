import { RESULT_LIMITS } from "./resultInput";
import {
  guideSource,
  isVerified,
  missingRequiredCards,
  type LinkRef,
  type ResearchState,
} from "./research";
import { candidateSearchUrl } from "./shopLinks";
import type { SentCandidate } from "./volunteerView";

// 리서치 챗 상태 → 기존 POST /api/volunteer/requests/[id]/result 본문(설계 지침 7절). 스키마는 그대로다.
// 서버는 한도를 넘으면 400으로 거부하므로, 여기서 코드포인트 단위로 먼저 자른다.

export type ResultBody = { candidates: SentCandidate[] };

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** 코드포인트 기준으로 max자 이하로 자른다. 잘리면 끝을 "…"로 바꾼다. max가 1 미만이면 빈 글자. */
export function clip(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = [...value];
  if (chars.length <= max) return value;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

type Item = { label: string; value: string };

/** 값이 비면 null(서버는 빈 요약 값을 거부한다). 줄바꿈은 한 줄로 합치고 200자로 자른다. */
function item(label: string, value: string): Item | null {
  const text = clip(oneLine(value), RESULT_LIMITS.valueMax);
  return text === "" ? null : { label, value: text };
}

/**
 * 링크 줄. "제목 주소" 모양이고 값 한도(200자) 안에서 제목을 줄여 맞춘다.
 * 제목 자리가 1자도 없으면 주소만 넣고, 주소 자체가 한도를 넘으면 이 링크는 뺀다(주소를 자르면 못 쓰는 주소가 된다).
 */
function linkItem(label: string, link: LinkRef): Item | null {
  const url = link.url.trim();
  const urlLength = [...url].length;
  if (!url.startsWith("https://") || urlLength > RESULT_LIMITS.valueMax) return null;
  const room = RESULT_LIMITS.valueMax - urlLength - 1;
  const title = room >= 1 ? clip(oneLine(link.title), room) : "";
  return { label, value: title === "" ? url : `${title} ${url}` };
}

function withLinks(prefix: string, links: readonly LinkRef[]): Item[] {
  const items: Item[] = [];
  for (const link of links) {
    if (items.length >= 2) break;
    const made = linkItem(`${prefix} ${items.length + 1}`, link);
    if (made) items.push(made);
  }
  return items;
}

/**
 * 후보 1 = 추천 기종(핵심 정리·요약 최대 12개), 후보 2~3 = 같이 고민한 제품.
 * 필수 카드가 비었으면 null. 결과에는 "구매 인증됨"과 "리서치만" 중 하나만 든다.
 */
export function buildResultBody(state: ResearchState): ResultBody | null {
  if (missingRequiredCards(state).length > 0) return null;

  const photoCount = state.photos.length;
  const descriptions = state.photos.map((photo) => oneLine(photo.description)).filter((text) => text !== "");
  const photoValue = photoCount === 0 ? "" : `${photoCount}장${descriptions.length ? ` · ${descriptions.join(" / ")}` : ""}`;

  const summary = [
    item("구분", "추천 기종"),
    item("구매 인증", isVerified(state) ? "구매 인증됨" : "리서치만"),
    item("장점", state.pros),
    item("사진", photoValue),
    item("같이 고민한 제품", state.alts.join(", ")),
    item("고민한 이유", state.altReason),
    item("혜택", state.benefits),
    ...withLinks("혜택 링크", state.checked.benefits),
    item("참고 글", state.refs),
    ...withLinks("참고 링크", state.checked.refs),
  ].filter((entry): entry is Item => entry !== null);

  const name = clip(oneLine(state.model), RESULT_LIMITS.nameMax);

  const candidates: SentCandidate[] = [
    {
      name,
      url: candidateSearchUrl(name),
      guide: clip(guideSource(state), RESULT_LIMITS.guideMax),
      summary: summary.slice(0, RESULT_LIMITS.summaryMax),
    },
  ];

  const reason = item("고민한 이유", state.altReason);
  for (const alt of state.alts.slice(0, RESULT_LIMITS.maxCandidates - 1)) {
    const altName = clip(oneLine(alt), RESULT_LIMITS.nameMax);
    if (altName === "") continue;
    candidates.push({
      name: altName,
      url: candidateSearchUrl(altName),
      guide: "",
      summary: [{ label: "구분", value: "같이 고민한 제품" }, ...(reason ? [reason] : [])],
    });
  }
  return { candidates };
}
