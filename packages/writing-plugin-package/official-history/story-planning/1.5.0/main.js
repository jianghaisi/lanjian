// Policy assets are interpreted by the host; this package has no executable tools.
export function execute() { throw new Error('No executable tool is declared'); }
