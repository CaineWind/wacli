import type { RefObject } from 'react';

type ShellMinimalViewProps = {
  terminalContainerRef: RefObject<HTMLDivElement>;
};

export default function ShellMinimalView({
  terminalContainerRef,
}: ShellMinimalViewProps) {
  return (
    <div className="relative h-full w-full bg-gray-900">
      <div className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] top-0 md:bottom-0">
        <div
          ref={terminalContainerRef}
          className="h-full w-full focus:outline-none"
          style={{ outline: 'none' }}
        />
      </div>
    </div>
  );
}
