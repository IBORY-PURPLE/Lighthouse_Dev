import "server-only";

export type Volunteer = {
  id: string;
  displayName: string;
};

/**
 * 등록된 봉사자 1명. 전화번호와 비밀번호는 환경 변수에만 있고(`volunteerAuth.ts`),
 * 표시 이름은 번호에서 만들지 않는다(이름이 사람을 드러내지 않게).
 */
export const REGISTERED_VOLUNTEER: Volunteer = {
  id: "vol-01",
  displayName: "등록 봉사자",
};
