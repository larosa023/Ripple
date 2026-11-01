//! "Watching …" on your Discord profile, via Discord's local IPC pipe
//! (\\.\pipe\discord-ipc-N). Nothing is sent anywhere else; if Discord isn't
//! running, calls fail quietly and Ripple carries on.

use serde_json::Value;

#[cfg(windows)]
mod imp {
    use super::*;
    use serde_json::json;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::sync::Mutex;

    static CONN: Mutex<Option<(String, File)>> = Mutex::new(None);

    fn write_frame(f: &mut File, op: u32, body: &Value) -> std::io::Result<()> {
        let data = body.to_string();
        let mut buf = Vec::with_capacity(8 + data.len());
        buf.extend_from_slice(&op.to_le_bytes());
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(data.as_bytes());
        f.write_all(&buf)?;
        f.flush()
    }

    fn read_frame(f: &mut File) -> std::io::Result<(u32, Value)> {
        let mut head = [0u8; 8];
        f.read_exact(&mut head)?;
        let op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        if len > 1 << 20 {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut body = vec![0u8; len];
        f.read_exact(&mut body)?;
        Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
    }

    fn connect(client_id: &str) -> Result<File, String> {
        for i in 0..10 {
            let path = format!(r"\\.\pipe\discord-ipc-{i}");
            let Ok(mut f) = std::fs::OpenOptions::new().read(true).write(true).open(&path) else { continue };
            write_frame(&mut f, 0, &json!({ "v": 1, "client_id": client_id })).map_err(|e| e.to_string())?;
            let (op, v) = read_frame(&mut f).map_err(|e| e.to_string())?;
            if op == 2 {
                // Discord closed the handshake: almost always an invalid application id.
                let msg = v.get("message").and_then(Value::as_str).unwrap_or("rejected");
                return Err(format!("Discord rejected the application ID ({msg})."));
            }
            return Ok(f);
        }
        Err("Discord isn't running.".into())
    }

    pub fn set(client_id: &str, activity: Option<Value>) -> Result<(), String> {
        // try_lock: if a previous update is stuck waiting on Discord, skip this one rather than pile up.
        let mut guard = CONN.try_lock().map_err(|_| "Discord is busy.".to_string())?;
        for attempt in 0..2 {
            if guard.as_ref().map(|(id, _)| id != client_id).unwrap_or(true) {
                *guard = None;
                if activity.is_none() {
                    return Ok(()); // nothing to clear
                }
                *guard = Some((client_id.to_string(), connect(client_id)?));
            }
            let (_, f) = guard.as_mut().unwrap();
            let nonce = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
            let msg = json!({
                "cmd": "SET_ACTIVITY",
                "args": { "pid": std::process::id(), "activity": activity.clone().unwrap_or(Value::Null) },
                "nonce": nonce,
            });
            match write_frame(f, 1, &msg).and_then(|_| read_frame(f)) {
                Ok((2, _)) | Err(_) => {
                    // Discord restarted or the pipe dropped: reconnect once.
                    *guard = None;
                    if attempt == 1 {
                        return Err("Lost the connection to Discord.".into());
                    }
                }
                Ok((_, reply)) => {
                    if reply.get("evt").and_then(Value::as_str) == Some("ERROR") {
                        let m = reply.pointer("/data/message").and_then(Value::as_str).unwrap_or("error");
                        return Err(format!("Discord: {m}"));
                    }
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    pub fn close() {
        // Never block app exit on a stuck Discord pipe.
        if let Ok(mut g) = CONN.try_lock() {
            *g = None;
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn set(_client_id: &str, activity: Option<Value>) -> Result<(), String> {
        if activity.is_none() {
            Ok(())
        } else {
            Err("Discord status is available on Windows.".into())
        }
    }
    pub fn close() {}
}

/// Sets (or with `activity: null`, clears) your Discord activity.
#[tauri::command]
pub async fn discord_set(client_id: String, activity: Option<Value>) -> Result<(), String> {
    let id = client_id.trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Enter your Discord application ID (numbers only).".into());
    }
    tauri::async_runtime::spawn_blocking(move || imp::set(&id, activity)).await.map_err(|e| e.to_string())?
}

pub fn shutdown() {
    imp::close();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_ids() {
        let r = tauri::async_runtime::block_on(discord_set("abc".into(), None));
        assert!(r.unwrap_err().contains("application ID"));
    }
}
