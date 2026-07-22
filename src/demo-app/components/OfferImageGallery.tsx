import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Link, LoaderCircle, RotateCcw, RotateCw, Trash2, Upload, X } from "lucide-react";

import { T, translateMessage, useI18n } from "../lib/i18n";

type Props = {
  images: string[];
  onChange: (images: string[]) => void;
  // Upload z dysku. Opcjonalny — platformy przyjmujące tylko URL (Erli) go pomijają.
  onUpload?: (file: File) => Promise<string>;
  onUploaded?: (url: string, file: File) => void;
  allowUpload?: boolean;
};

export default function OfferImageGallery({ images, onChange, onUpload, onUploaded, allowUpload = true }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[][]>([]);
  const [future, setFuture] = useState<string[][]>([]);
  const [preview, setPreview] = useState("");

  const commit = (next: string[]) => {
    setHistory((items) => [...items, images]);
    setFuture([]);
    onChange(next);
  };
  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [images, ...items]);
    onChange(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items, images]);
    onChange(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    const next = [...images];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    commit(next);
  };

  const upload = async (file?: File) => {
    if (!file || !onUpload) return;
    setUploading(true);
    setError("");
    try {
      const location = await onUpload(file);
      if (onUploaded) onUploaded(location, file);
      else commit([...images, location]);
    } catch (value) {
      setError(translateMessage(value, t));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const addUrl = () => {
    const next = url.trim();
    if (!next) return;
    commit([...images, next]);
    setUrl("");
  };

  return <div className="offer-gallery">
    {allowUpload && <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp"
      onChange={(event) => void upload(event.target.files?.[0])}
    />}
    <div className="offer-gallery-tools">
      <button type="button" className="btn btn-ghost btn-icon" disabled={history.length === 0} title={t(T.offer_description_undo)} onClick={undo}><RotateCcw size={15} /></button>
      <button type="button" className="btn btn-ghost btn-icon" disabled={future.length === 0} title={t(T.offer_description_redo)} onClick={redo}><RotateCw size={15} /></button>
    </div>
    <div className="offer-image-grid">
      {images.map((image, index) => <article className="offer-image-item" key={`${image}-${index}`}>
        <button type="button" className="offer-image-preview" onClick={() => image && setPreview(image)}>{image ? <img src={image} alt="" /> : <ImagePlus size={24} />}</button>
        {index === 0 && <span className="offer-image-main">{t(T.offer_image_main)}</span>}
        <div className="offer-image-actions">
          <button type="button" className="btn btn-ghost btn-icon" disabled={index === 0} title={t(T.offer_move_left)} onClick={() => move(index, -1)}><ArrowLeft size={14} /></button>
          <button type="button" className="btn btn-ghost btn-icon" disabled={index === images.length - 1} title={t(T.offer_move_right)} onClick={() => move(index, 1)}><ArrowRight size={14} /></button>
          <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => commit(images.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
        </div>
      </article>)}
    </div>
    <div className="offer-upload-row">
      {allowUpload && <button type="button" className="btn btn-secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
        {uploading ? t(T.offer_uploading_image) : t(T.offer_upload_from_computer)}
      </button>}
      <div className="offer-url-add"><Link size={14} /><input className="input" type="url" value={url} placeholder={t(T.offer_image_url)} onChange={(event) => setUrl(event.target.value)} /><button type="button" className="btn btn-secondary" disabled={!url.trim()} onClick={addUrl}>{t(T.offer_add_image)}</button></div>
    </div>
    {error && <div className="commerce-alert danger compact">{error}</div>}
    {preview && <div className="offer-image-lightbox" role="dialog" aria-modal="true" onClick={() => setPreview("")}>
      <button type="button" className="btn btn-secondary btn-icon" title={t(T.common_close)} onClick={() => setPreview("")}><X size={17} /></button>
      <img src={preview} alt="" />
    </div>}
  </div>;
}
