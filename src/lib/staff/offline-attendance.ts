export type OfflineAttendanceAction = "check_in" | "check_out";
export type OfflineAttendanceStatus = "pending" | "rejected";

export type OfflineAttendanceEvent = {
  request_id: string;
  user_id: string;
  staff_id: string;
  action: OfflineAttendanceAction;
  captured_at: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number;
  status: OfflineAttendanceStatus;
  error: string | null;
};

export type OfflineAttendanceProfile = {
  user_id: string;
  staff: {
    id: string;
    school_id: string;
    employee_no: string | null;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    designation: string | null;
    email: string | null;
  };
  attendance_mode: "online" | "offline";
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
};

const DATABASE_NAME = "edunexa-staff-attendance";
const DATABASE_VERSION = 1;
const EVENTS_STORE = "events";
const PROFILE_STORE = "profile";
const PROFILE_KEY = "current";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EVENTS_STORE)) {
        database.createObjectStore(EVENTS_STORE, {
          keyPath: "request_id",
        });
      }
      if (!database.objectStoreNames.contains(PROFILE_STORE)) {
        database.createObjectStore(PROFILE_STORE, {
          keyPath: "key",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Unable to open offline attendance storage."));
  });
}

async function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Offline attendance storage failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Offline attendance transaction failed."));
    };
  });
}

export function saveOfflineAttendanceEvent(
  event: OfflineAttendanceEvent,
): Promise<IDBValidKey> {
  return runTransaction(EVENTS_STORE, "readwrite", (store) =>
    store.put(event),
  );
}

export function listOfflineAttendanceEvents(): Promise<OfflineAttendanceEvent[]> {
  return runTransaction(EVENTS_STORE, "readonly", (store) =>
    store.getAll(),
  );
}

export function deleteOfflineAttendanceEvent(
  requestId: string,
): Promise<undefined> {
  return runTransaction(EVENTS_STORE, "readwrite", (store) =>
    store.delete(requestId),
  );
}

export function saveOfflineAttendanceProfile(
  profile: OfflineAttendanceProfile,
): Promise<IDBValidKey> {
  return runTransaction(PROFILE_STORE, "readwrite", (store) =>
    store.put({ key: PROFILE_KEY, ...profile }),
  );
}

export async function getOfflineAttendanceProfile(): Promise<OfflineAttendanceProfile | null> {
  const profile = await runTransaction<
    ({ key: string } & OfflineAttendanceProfile) | undefined
  >(PROFILE_STORE, "readonly", (store) => store.get(PROFILE_KEY));
  if (!profile) return null;
  return {
    user_id: profile.user_id,
    staff: profile.staff,
    attendance_mode: profile.attendance_mode,
    attendance_date: profile.attendance_date,
    check_in_at: profile.check_in_at,
    check_out_at: profile.check_out_at,
  };
}

export async function updateOfflineAttendanceEvent(
  requestId: string,
  update: Partial<OfflineAttendanceEvent>,
): Promise<void> {
  const events = await listOfflineAttendanceEvents();
  const event = events.find((item) => item.request_id === requestId);
  if (!event) return;
  await saveOfflineAttendanceEvent({ ...event, ...update });
}
