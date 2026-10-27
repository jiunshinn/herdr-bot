import { useEffect, useRef, useState } from "react";

interface Props {
  placeholder: string;
  disabled?: boolean;
  /** Set by the parent when an image is dropped anywhere on the agent view. */
  droppedImage: File | null;
  onConsumeDrop(): void;
  onSend(text: string, image: File | null): Promise<void>;
}

export function Composer({ placeholder, disabled, droppedImage, onConsumeDrop, onSend }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<string | null>(null);

  useEffect(() => {
    if (droppedImage) {
      setImage(droppedImage);
      onConsumeDrop();
    }
  }, [droppedImage, onConsumeDrop]);

  // Grow with the text up to the CSS max-height.
  useEffect(() => {
    const el = input.current!;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  if (preview.current && !image) {
    URL.revokeObjectURL(preview.current);
    preview.current = null;
  }
  if (image && !preview.current) preview.current = URL.createObjectURL(image);

  const send = async () => {
    if (sending || disabled || (!text.trim() && !image)) return;
    setSending(true);
    try {
      await onSend(text.trim(), image);
      setText("");
      setImage(null);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  return (
    <div className="composer">
      {image && (
        <div className="attachment">
          <img src={preview.current ?? undefined} alt="" />
          <span>{image.name || "Pasted image"}</span>
          <button className="icon-btn" onClick={() => setImage(null)} aria-label="Remove image">
            ×
          </button>
        </div>
      )}
      <div className="composer-box">
        <label className="icon-btn attach" title="Attach an image">
          +
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setImage(f);
              e.target.value = "";
            }}
          />
        </label>
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (f) {
              e.preventDefault();
              setImage(f);
            }
          }}
        />
        <button className="send" onClick={send} disabled={disabled || sending || (!text.trim() && !image)} aria-label="Send">
          ↑
        </button>
      </div>
    </div>
  );
}
