import { useEffect, useState } from 'react';

export function useClientOnlyValue<T>(web: T, native: T): T {
  const [value, setValue] = useState(native);
  useEffect(() => { setValue(web); }, [web]);
  return value;
}
