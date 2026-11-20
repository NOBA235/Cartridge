/**
 * Hidden developer page at /dev. Not linked from the app.
 * Prepare this device (real Gemini Nano download) and Ask cloud (real call,
 * after approval). Shows inferenceSource. No stand-in models or sample data.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { cloudJson, CloudError } from '@/ai/cloud';
import { deviceSessions } from '@/ai/deviceSessions';
import { getFirebase } from '@/ai/firebase';
import { DEV_PING_TEMPLATE } from '@/ai/prompts';
import { config } from '@/config';
import { DEV_PING_TASK, DevPingReply } from '@/dev/devTasks';
import { asPrivate, fillTemplate, type Public } from '@/privacy';
import { CloudSetting } from '@/ui/components/CloudSetting';
import { DeclassifyDialog, type DeclassifyRequest } from '@/ui/components/DeclassifyDialog';
import { useDeviceState } from '@/ui/components/DevicePanel';
import { RouteBadge, routeFromInferenceSource } from '@/ui/components/RouteBadge';
import { useOnline } from '@/ui/hooks/useStores';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/primitives/card';
import { inputClass } from '@/ui/styles';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DevPage() {
  const fb = useMemo(() => getFirebase(), []);
  const online = useOnline();
  const device = useDeviceState();

  const [cloudQ, setCloudQ] = useState('Say hello in five words.');
  const [pending, setPending] = useState<DeclassifyRequest | null>(null);
  const [cloudResult, setCloudResult] = useState<{
    reply: string;
    source?: string;
    attempts: number;
  } | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);

  const prepare = () => void deviceSessions.prepare();

  const askCloud = (e: FormEvent) => {
    e.preventDefault();
    setCloudError(null);
    setCloudResult(null);
    setPending({
      value: asPrivate(cloudQ, 'user-question'),
      purpose: 'Developer page cloud test',
      scope: 'dev',
      destination: `the cloud model (${config.cloudModels.DEV_PING}) through Firebase AI Logic`,
      fullRequest: DEV_PING_TEMPLATE.value.replace('{{message}}', cloudQ),
    });
  };

  const sendApproved = async (message: Public<string>) => {
    setPending(null);
    setCloudBusy(true);
    try {
      const prompt = fillTemplate(DEV_PING_TEMPLATE, { message });
      const res = await cloudJson(DEV_PING_TASK, prompt, DevPingReply);
      setCloudResult({
        reply: res.data.reply,
        source: res.inferenceSource,
        attempts: res.attempts,
      });
    } catch (err) {
      const msg =
        err instanceof CloudError ? `${err.code}: ${err.message}` : (err as Error).message;
      setCloudError(msg);
    } finally {
      setCloudBusy(false);
    }
  };

  const cloudRoute = routeFromInferenceSource(cloudResult?.source);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Hidden developer page
        </p>
        <h1 className="text-2xl font-semibold">/dev: hybrid plumbing check</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-1">
            <Row label="Firebase">
              {fb.ok ? `Connected to ${fb.app.options.projectId ?? '?'}` : fb.reason}
            </Row>
            <Row label="App Check">{fb.ok ? fb.appCheckMode : 'Not started'}</Row>
            <Row label="Device model">Gemini Nano via Firebase AI Logic</Row>
            <Row label="Network">{online ? 'Online' : 'Offline'}</Row>
            <Row label="Cloud models">
              <code className="text-xs">
                {Object.entries(config.cloudModels)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </code>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>1. Prepare this device</CardTitle>
          <CardDescription>
            Downloads Gemini Nano on first use. This can take several minutes and must start from a
            click. Asking the device a question needs the rules of a real cartridge, so it is
            checked once a rulebook has been turned into a cartridge.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={prepare} disabled={device.state === 'preparing'} className="self-start">
            {device.state === 'preparing' ? 'Preparing…' : 'Prepare this device'}
          </Button>
          {device.state === 'preparing' && (
            <div>
              <progress
                className="h-2 w-full accent-primary"
                value={device.progress}
                max={1}
                aria-label="Download progress"
              />
              <p className="text-xs text-muted-foreground">{Math.round(device.progress * 100)}%</p>
            </div>
          )}
          {device.state !== 'idle' && device.state !== 'preparing' && (
            <p className="text-sm" role="status">
              {device.state === 'ready' ? 'Ready (firebase)' : `Unavailable: ${device.reason}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Ask cloud</CardTitle>
          <CardDescription>
            Your text is Private. You will see exactly what is sent and approve it first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={askCloud} className="flex flex-col gap-3">
            <label className="text-sm" htmlFor="cloud-q">
              Message
            </label>
            <input
              id="cloud-q"
              className={inputClass}
              value={cloudQ}
              onChange={(e) => setCloudQ(e.target.value)}
            />
            <Button type="submit" disabled={cloudBusy || !cloudQ.trim()} className="self-start">
              {cloudBusy ? 'Waiting for the cloud…' : 'Ask cloud'}
            </Button>
          </form>
          {cloudResult && (
            <dl className="mt-4 flex flex-col gap-1">
              <Row label="Route">{cloudRoute ? <RouteBadge route={cloudRoute} /> : 'unknown'}</Row>
              <Row label="inferenceSource">{cloudResult.source ?? 'not reported'}</Row>
              <Row label="Attempts">{cloudResult.attempts}</Row>
              <Row label="Reply">{cloudResult.reply}</Row>
            </dl>
          )}
          {cloudError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {cloudError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CloudSetting screen="ask" />
          <CloudSetting screen="canvas" />
        </CardContent>
      </Card>

      <DeclassifyDialog
        request={pending}
        onApproved={sendApproved}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
