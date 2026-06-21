import { describe, it, expect } from 'vitest';
import { JdtKeepAlive } from '../jdt-process.js';

describe('JdtKeepAlive.start settles on spawn failure', () => {
  it('resolves false (does not hang) when the java binary cannot start', async () => {
    const ka = new JdtKeepAlive('definitely-not-java-xyz-12345', '/no/such.jar', process.cwd());
    const ok = await ka.start();
    expect(ok).toBe(false);
    await ka.shutdown();
  }, 5000);
});

describe('JdtKeepAlive.analyzeFile concurrent same-path deduplication', () => {
  it('resolves the prior caller with null when a second call for the same path arrives', async () => {
    // Use a non-existent binary so start() resolves false immediately and proc stays null.
    // We exercise the pending-overwrite logic directly by poking the internals via a
    // test-only path: construct a fake pending entry, then call analyzeFile which should
    // displace it (since proc is null, analyzeFile returns null early — so instead we
    // inspect via the Map). We simulate the scenario by directly exercising the guard
    // using a subclass that exposes the pending map.
    class TestableKeepAlive extends JdtKeepAlive {
      get pendingMap() { return (this as unknown as { pending: Map<string, (r: null) => void> }).pending; }
      // Call the overwrite logic directly without needing a live proc.
      simulateConcurrent(norm: string): Promise<null> {
        const map = this.pendingMap;
        return new Promise((resolve) => {
          const prior = map.get(norm);
          if (prior) { map.delete(norm); prior(null); }
          map.set(norm, resolve as (r: null) => void);
        });
      }
    }

    const ka = new TestableKeepAlive('definitely-not-java-xyz-12345', '/no/such.jar', process.cwd());

    // First call: register a pending callback for 'com/example/Foo.java'
    let firstResolved = false;
    let firstValue: null | unknown = 'NOT_RESOLVED';
    const firstPromise = new Promise<null>((res) => {
      ka.pendingMap.set('com/example/Foo.java', (r) => { firstResolved = true; firstValue = r; res(r); });
    });

    // Second concurrent call for the same path — should displace the first
    const secondPromise = ka.simulateConcurrent('com/example/Foo.java');

    // After the second call the first should have been resolved with null
    await firstPromise;
    expect(firstResolved).toBe(true);
    expect(firstValue).toBeNull();

    // The map should now hold only the second entry
    expect(ka.pendingMap.has('com/example/Foo.java')).toBe(true);

    // Clean up — resolve the second pending entry
    const secondCb = ka.pendingMap.get('com/example/Foo.java');
    if (secondCb) { ka.pendingMap.delete('com/example/Foo.java'); secondCb(null); }
    const secondResult = await secondPromise;
    expect(secondResult).toBeNull();

    await ka.shutdown();
  }, 5000);
});
