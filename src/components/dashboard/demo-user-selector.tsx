import type { SessionUser } from "@/lib/api/contracts";

type Props = {
  user: SessionUser | null;
  disabled: boolean;
  onSelect: (email: string | null) => Promise<void>;
};

export function DemoUserSelector({ user, disabled, onSelect }: Props) {
  return (
    <div className="demo-user-controls">
      {user && <span className="user-avatar" aria-hidden="true">{user.name.charAt(0)}</span>}
      <div className="user-select-field">
        <label htmlFor="demo-user">Demo user</label>
        <select id="demo-user" value={user?.email ?? ""} disabled={disabled}
          onChange={(event) => { void onSelect(event.target.value); }}>
          <option value="" disabled>Choose a user</option>
          <option value="alice@example.com">Alice Demo</option>
          <option value="bob@example.com">Bob Demo</option>
        </select>
      </div>
      {user && <button className="button button-quiet" disabled={disabled} onClick={() => { void onSelect(null); }}>Log out</button>}
    </div>
  );
}
