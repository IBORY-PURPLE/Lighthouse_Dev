/* eslint-disable @next/next/no-img-element -- 기기 안에서 만든 data URL 썸네일이라 next/image 최적화 대상이 아니다. */
import type { PhotoView } from "@/lib/researchClient";

/** 올린 사진 말풍선(미리보기 썸네일). 올리는 중이면 점과 문구, 지울 수 있다. */
export function PhotoBubble({
  photo,
  index,
  uploading,
  onRemove,
}: {
  photo: PhotoView | null;
  index: number;
  uploading?: boolean;
  onRemove?: (photo: PhotoView) => void;
}) {
  if (!photo) {
    return <p className="vc-bubble vc-bubble--me">지운 사진</p>;
  }
  return (
    <div className="vc-photo">
      {photo.thumb ? (
        <img src={photo.thumb} alt={photo.description ? `올린 사진 ${index}: ${photo.description}` : `올린 사진 ${index}`} className="vc-photo-img" width={160} height={160} />
      ) : (
        <span className="vc-photo-img vc-photo-img--blank">사진 {index}</span>
      )}
      {uploading ? (
        <span className="vc-photo-busy" aria-hidden="true">
          <i className="lh-thinking-dot" />
          <i className="lh-thinking-dot" />
          <i className="lh-thinking-dot" />
        </span>
      ) : (
        onRemove && (
          <button type="button" className="vc-photo-remove" onClick={() => onRemove(photo)}>
            사진 지우기<span className="vol-sr"> {index}</span>
          </button>
        )
      )}
    </div>
  );
}
