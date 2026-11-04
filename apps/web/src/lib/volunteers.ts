import "server-only";

export type Volunteer = {
  id: string;
  displayName: string;
  items: readonly string[];
};

export const VOLUNTEERS: readonly Volunteer[] = [
  { id: "v-01", displayName: "가상 봉사자 A", items: ["헤드셋"] },
  { id: "v-02", displayName: "가상 봉사자 B", items: ["헤드셋", "키보드"] },
  { id: "v-03", displayName: "가상 봉사자 C", items: ["키보드"] },
];
