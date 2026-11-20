import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, Panel } from '../components/ui/primitives';

export function NotFoundPage() {
  return (
    <Panel className="mx-auto mt-16 max-w-lg p-10 text-center">
      <Compass size={22} className="mx-auto text-text-dim" aria-hidden />
      <h1 className="mt-3 display text-[18px]">Page not found</h1>
      <p className="mt-1 text-[12px] text-text-muted">
        That route does not exist in CARDIOPULSE. The monitoring workspace is still running.
      </p>
      <div className="mt-4 flex justify-center">
        <Link to="/">
          <Button variant="primary">Back to Overview</Button>
        </Link>
      </div>
    </Panel>
  );
}
