/**
 * Shows the user exactly what will be sent to the cloud and asks for approval.
 * On Approve it calls grantApproval() for that exact text and declassify(), and
 * hands back the Public value. Nothing is sent by this dialog itself.
 */
import { useEffect, useRef } from 'react';
import {
  declassify,
  grantApproval,
  type DeclassifyScope,
  type Private,
  type Public,
} from '@/privacy';
import { Button } from '@/ui/primitives/button';
import { utf8Bytes } from '@/telemetry/egress';

export interface DeclassifyRequest {
  value: Private<string>;
  purpose: string;
  scope: DeclassifyScope;
  destination: string;
  /** The full request as it will be sent, if our own public text wraps the user's text. */
  fullRequest?: string;
}

export function DeclassifyDialog({
  request,
  onApproved,
  onCancel,
}: {
  request: DeclassifyRequest | null;
  onApproved: (value: Public<string>) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (request && !d.open) d.showModal();
    if (!request && d.open) d.close();
  }, [request]);

  const approve = () => {
    if (!request) return;
    const approval = grantApproval(request.value.value, {
      purpose: request.purpose,
      scope: request.scope,
    });
    onApproved(declassify(request.value, approval));
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="declassify-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-lg rounded-xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60"
    >
      {request && (
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 id="declassify-title" className="text-lg font-semibold">
              Send this to the cloud?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This text is yours and has stayed on this device so far. If you approve, exactly the
              text below is sent to {request.destination}, and the send is listed in 'What left this
              device'.
            </p>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Exactly what will be sent</span>
              <span>{utf8Bytes(request.value.value)} bytes</span>
            </div>
            <pre className="max-h-64 overflow-auto rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap">
              {request.value.value}
            </pre>
          </div>
          {request.fullRequest !== undefined && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Show the full request, including our own instructions (
                {utf8Bytes(request.fullRequest)} bytes)
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap">
                {request.fullRequest}
              </pre>
            </details>
          )}
          <p className="text-xs text-muted-foreground">Purpose: {request.purpose}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel} autoFocus>
              Keep it on this device
            </Button>
            <Button onClick={approve}>Approve and send</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
