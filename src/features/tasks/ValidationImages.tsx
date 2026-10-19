import type { ValidationArtifacts } from "../../../shared/types.js";
import { ImagePreview } from "../images/ImageViewer.js";

export function ValidationImages({ record }: { record: ValidationArtifacts }) {
  if (!record.validationImages?.length && !record.validationImageIssues?.length)
    return null;
  return (
    <div className="validation-images">
      <h4>Screenshots from T3</h4>
      <div className="validation-gallery">
        {record.validationImages?.map((image) => (
          <figure key={image.id}>
            <ImagePreview image={image} lazy />
            <figcaption>{image.name}</figcaption>
            <details>
              <summary className="small muted">
                Original references · {image.sources.length}
              </summary>
              {image.sources.map((source, i) => (
                <p className="small preserve-text" key={i}>
                  {source.reference}
                </p>
              ))}
            </details>
          </figure>
        ))}
      </div>
      {record.validationImageIssues?.map((issue, i) => (
        <p className="small muted preserve-text" key={i}>
          Screenshot unavailable: {issue.reference}
          {issue.message}
        </p>
      ))}
    </div>
  );
}
