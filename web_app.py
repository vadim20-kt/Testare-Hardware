import os
import base64
import io
import mimetypes
import socket
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]
BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

app = Flask(__name__)
# A generated local secret is safer than shipping a predictable fallback.
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or os.urandom(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


class AuthenticationRequired(Exception):
    """Raised when a Sheets endpoint is used without valid Google credentials."""


def get_credentials():
    credentials = None
    try:
        if TOKEN_PATH.exists():
            credentials = Credentials.from_authorized_user_file(str(TOKEN_PATH))
            if not set(GOOGLE_SCOPES).issubset(set(credentials.scopes or [])):
                credentials = None
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
            TOKEN_PATH.write_text(credentials.to_json(), encoding="utf-8")
    except Exception:
        # An expired/revoked token or a temporary network error must not make
        # the entire application return HTTP 500. The user can reconnect.
        return None
    if not credentials or not credentials.valid:
        return None
    return credentials


def get_service():
    credentials = get_credentials()
    if credentials is None:
        raise AuthenticationRequired()
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def get_drive_service():
    credentials = get_credentials()
    if credentials is None:
        raise AuthenticationRequired()
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def parse_sheet_url(url):
    parsed = urlparse(url)
    parts = parsed.path.split("/")
    if parsed.netloc not in {"docs.google.com", "www.docs.google.com"} or "spreadsheets" not in parts or "d" not in parts:
        raise ValueError("Linkul nu este un link Google Sheets valid.")
    try:
        document_id = parts[parts.index("d") + 1]
    except (ValueError, IndexError):
        raise ValueError("Linkul nu conține ID-ul documentului.") from None
    if not document_id:
        raise ValueError("Linkul nu conține ID-ul documentului.")
    gid = parse_qs(parsed.fragment).get("gid", parse_qs(parsed.query).get("gid", [None]))[0]
    return document_id, gid


def get_sheet(service, document_id, gid=None, title=None):
    metadata = service.spreadsheets().get(
        spreadsheetId=document_id,
        fields="sheets(properties(sheetId,title))",
    ).execute()
    sheets = metadata.get("sheets", [])
    if title:
        for sheet in sheets:
            if sheet["properties"].get("title") == title:
                return sheet["properties"]
    if gid:
        for sheet in sheets:
            if str(sheet["properties"].get("sheetId")) == str(gid):
                return sheet["properties"]
    if sheets:
        return sheets[0]["properties"]
    raise ValueError("Documentul nu conține nicio foaie.")


def read_sheet(service, document_id, sheet_title):
    return service.spreadsheets().values().get(
        spreadsheetId=document_id,
        range=f"'{sheet_title}'!A:ZZZ",
        valueRenderOption="FORMULA",
    ).execute().get("values", [])

def list_sheets(service, document_id):
    metadata = service.spreadsheets().get(
        spreadsheetId=document_id,
        fields="sheets(properties(sheetId,title))",
    ).execute()
    return [sheet["properties"] for sheet in metadata.get("sheets", [])]


def get_sheet_properties(service, document_id, title):
    for sheet in list_sheets(service, document_id):
        if sheet.get("title") == title:
            return sheet
    raise ValueError(f"Foaia '{title}' nu a fost găsită.")

def column_name(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def active_sheet_id(service, document_id, title):
    return get_sheet_properties(service, document_id, title)["sheetId"]


def api_error(error):
    if isinstance(error, AuthenticationRequired):
        return jsonify(error="AUTH_REQUIRED"), 401
    return jsonify(error=str(error)), 400


@app.get("/")
def index():
    return render_template("index.html", authenticated=get_credentials() is not None)


@app.get("/login")
def login():
    if not CREDENTIALS_PATH.exists():
        return "Lipsește credentials.json în folderul aplicației.", 500
    flow = Flow.from_client_secrets_file(
        str(CREDENTIALS_PATH), scopes=GOOGLE_SCOPES,
        redirect_uri=url_for("oauth_callback", _external=True),
    )
    authorization_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent"
    )
    session["oauth_state"] = state
    session["oauth_code_verifier"] = flow.code_verifier
    return redirect(authorization_url)


@app.get("/reauth")
def reauth():
    if TOKEN_PATH.exists():
        TOKEN_PATH.unlink()
    return redirect(url_for("login"))


@app.get("/oauth2callback")
def oauth_callback():
    if not CREDENTIALS_PATH.exists():
        return "Lipsește credentials.json în folderul aplicației.", 500
    flow = Flow.from_client_secrets_file(
        str(CREDENTIALS_PATH), scopes=GOOGLE_SCOPES,
        state=session.get("oauth_state"),
        redirect_uri=url_for("oauth_callback", _external=True),
    )
    flow.code_verifier = session.get("oauth_code_verifier")
    try:
        flow.fetch_token(authorization_response=request.url)
    except Exception as error:
        return (
            "Autentificarea Google nu a putut fi finalizată. "
            "Închide această pagină și pornește din nou /reauth. "
            f"Detalii: {error}",
            400,
        )
    TOKEN_PATH.write_text(flow.credentials.to_json(), encoding="utf-8")
    session.pop("oauth_state", None)
    session.pop("oauth_code_verifier", None)
    return redirect(url_for("index"))


@app.post("/api/load")
def load_document():
    try:
        document_id, gid = parse_sheet_url(request.json.get("url", "").strip())
        service = get_service()
        sheet = get_sheet(service, document_id, gid=gid)
        sheets = list_sheets(service, document_id)
        session["document_id"] = document_id
        session["gid"] = gid
        session["sheet_title"] = sheet["title"]
        return jsonify(
            data=read_sheet(service, document_id, sheet["title"]),
            title=sheet["title"],
            sheets=[{"id": item["sheetId"], "title": item["title"]} for item in sheets],
        )
    except Exception as error:
        return api_error(error)


@app.get("/api/data")
def get_data():
    try:
        document_id = session["document_id"]
        service = get_service()
        sheet = get_sheet(service, document_id, gid=session.get("gid"), title=session.get("sheet_title"))
        session["sheet_title"] = sheet["title"]
        return jsonify(data=read_sheet(service, document_id, sheet["title"]), title=sheet["title"])
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/sheet")
def select_sheet():
    try:
        document_id = session["document_id"]
        title = request.json.get("title", "")
        service = get_service()
        sheet = get_sheet(service, document_id, title=title)
        session["sheet_title"] = sheet["title"]
        return jsonify(data=read_sheet(service, document_id, sheet["title"]), title=sheet["title"])
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/sheet/create")
def create_sheet():
    try:
        document_id = session["document_id"]
        title = request.json.get("title", "").strip()
        if not title:
            raise ValueError("Numele foii este obligatoriu.")
        service = get_service()
        service.spreadsheets().batchUpdate(
            spreadsheetId=document_id,
            body={"requests": [{"addSheet": {"properties": {"title": title}}}]},
        ).execute()
        session["sheet_title"] = title
        return jsonify(title=title, sheets=list_sheets(service, document_id), data=[])
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/sheet/delete")
def delete_sheet():
    try:
        document_id = session["document_id"]
        title = session["sheet_title"]
        service = get_service()
        sheets = list_sheets(service, document_id)
        if len(sheets) < 2:
            raise ValueError("Documentul trebuie să păstreze cel puțin o foaie.")
        sheet_id = active_sheet_id(service, document_id, title)
        service.spreadsheets().batchUpdate(
            spreadsheetId=document_id,
            body={"requests": [{"deleteSheet": {"sheetId": sheet_id}}]},
        ).execute()
        next_sheet = list_sheets(service, document_id)[0]
        session["sheet_title"] = next_sheet["title"]
        session["gid"] = str(next_sheet["sheetId"])
        return jsonify(title=next_sheet["title"], sheets=list_sheets(service, document_id),
                       data=read_sheet(service, document_id, next_sheet["title"]))
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/sheet/rename")
def rename_sheet():
    try:
        document_id = session["document_id"]
        title = (request.json or {}).get("title", "").strip()
        if not title:
            raise ValueError("Numele foii este obligatoriu.")
        service = get_service()
        current_title = session["sheet_title"]
        sheet_id = active_sheet_id(service, document_id, current_title)
        service.spreadsheets().batchUpdate(
            spreadsheetId=document_id,
            body={"requests": [{"updateSheetProperties": {
                "properties": {"sheetId": sheet_id, "title": title}, "fields": "title",
            }}]},
        ).execute()
        session["sheet_title"] = title
        return jsonify(title=title, sheets=list_sheets(service, document_id))
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/dimension")
def update_dimension():
    try:
        document_id = session["document_id"]
        payload = request.json or {}
        dimension = payload.get("dimension")
        action = payload.get("action")
        try:
            index = int(payload.get("index", 0))
        except (TypeError, ValueError):
            raise ValueError("Index invalid.") from None
        if dimension not in {"ROWS", "COLUMNS"} or action not in {"append", "delete"} or index < 0:
            raise ValueError("Operație de structură invalidă.")
        service = get_service()
        title = session["sheet_title"]
        sheet_id = active_sheet_id(service, document_id, title)
        if action == "append":
            operation = {"appendDimension": {"sheetId": sheet_id, "dimension": dimension, "length": 1}}
        else:
            operation = {"deleteDimension": {"range": {
                "sheetId": sheet_id, "dimension": dimension, "startIndex": index, "endIndex": index + 1,
            }}}
        service.spreadsheets().batchUpdate(spreadsheetId=document_id, body={"requests": [operation]}).execute()
        return jsonify(ok=True, data=read_sheet(service, document_id, title))
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/table")
def create_table():
    try:
        document_id = session["document_id"]
        payload = request.json
        values = payload.get("values", [])
        if not values or not any(values):
            raise ValueError("Tabelul trebuie să conțină date.")
        service = get_service()
        title = session["sheet_title"]
        start_row = int(payload.get("startRow", 1))
        start_column = int(payload.get("startColumn", 1))
        end_column = start_column + max(len(row) for row in values) - 1
        start_cell = f"{column_name(start_column)}{start_row}"
        end_cell = f"{column_name(end_column)}{start_row + len(values) - 1}"
        service.spreadsheets().values().update(
            spreadsheetId=document_id,
            range=f"'{title}'!{start_cell}",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
        service.spreadsheets().batchUpdate(
            spreadsheetId=document_id,
            body={"requests": [{"updateBorders": {"range": {
                "sheetId": get_sheet_properties(service, document_id, title)["sheetId"],
                "startRowIndex": start_row - 1,
                "endRowIndex": start_row - 1 + len(values),
                "startColumnIndex": start_column - 1,
                "endColumnIndex": end_column,
            }, "top": {"style": "SOLID", "width": 1}, "bottom": {"style": "SOLID", "width": 1},
                "left": {"style": "SOLID", "width": 1}, "right": {"style": "SOLID", "width": 1},
                "innerHorizontal": {"style": "SOLID", "width": 1}, "innerVertical": {"style": "SOLID", "width": 1}}}]},
        ).execute()
        return jsonify(ok=True, data=read_sheet(service, document_id, title), range=f"{start_cell}:{end_cell}")
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/diagram")
def create_diagram():
    try:
        document_id = session["document_id"]
        payload = request.json
        nodes = payload.get("nodes", [])
        if not nodes:
            raise ValueError("Schema trebuie să conțină cel puțin un element.")
        service = get_service()
        title = session["sheet_title"]
        values = [["SCHEMĂ", payload.get("name", "Schema nouă")], ["Element", "Descriere", "Legat de"]]
        values.extend([[node.get("name", ""), node.get("description", ""), node.get("connectsTo", "")] for node in nodes])
        service.spreadsheets().values().append(
            spreadsheetId=document_id, range=f"'{title}'!A:Z", valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS", body={"values": values},
        ).execute()
        return jsonify(ok=True, data=read_sheet(service, document_id, title))
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


@app.post("/api/image")
def upload_image():
    try:
        document_id = session["document_id"]
        payload = request.json
        data_url = payload.get("dataUrl", "")
        if not data_url.startswith("data:image/"):
            raise ValueError("Selectează o imagine validă.")
        header, encoded = data_url.split(",", 1)
        mime_type = header.split(";", 1)[0].split(":", 1)[1]
        image_bytes = base64.b64decode(encoded, validate=True)
        if len(image_bytes) > 8 * 1024 * 1024:
            raise ValueError("Imaginea trebuie să aibă cel mult 8 MB.")
        extension = mimetypes.guess_extension(mime_type) or ".png"
        drive = get_drive_service()
        file = drive.files().create(
            body={"name": f"sheet-image-{uuid.uuid4().hex}{extension}", "mimeType": mime_type},
            media_body=MediaIoBaseUpload(io.BytesIO(image_bytes), mimetype=mime_type),
            fields="id",
        ).execute()
        drive.permissions().create(fileId=file["id"], body={"type": "anyone", "role": "reader"}).execute()
        service = get_service()
        row, column = int(payload.get("row", 0)) + 1, int(payload.get("column", 0)) + 1
        cell = f"{column_name(column)}{row}"
        image_url = f"https://drive.google.com/uc?export=view&id={file['id']}"
        service.spreadsheets().values().update(
            spreadsheetId=document_id,
            range=f"'{session['sheet_title']}'!{cell}",
            valueInputOption="USER_ENTERED",
            body={"values": [[f'=IMAGE(\"{image_url}\")']]},
        ).execute()
        return jsonify(ok=True, fileId=file["id"], data=read_sheet(service, document_id, session["sheet_title"]))
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        error_text = str(error).lower()
        if "accessnotconfigured" in error_text or "drive api has not been used" in error_text or "drive.googleapis.com" in error_text:
            return jsonify(error="Google Drive API este dezactivat pentru proiectul OAuth. Activează-l în Google Cloud Console, așteaptă câteva minute, apoi reîncearcă."), 403
        if "insufficient" in error_text or "permission" in error_text:
            if TOKEN_PATH.exists():
                TOKEN_PATH.unlink()
            return jsonify(error="Permisiunea Google Drive lipsește. Deschide /reauth, acceptă accesul Drive, apoi încearcă din nou."), 403
        return api_error(error)


@app.post("/api/save")
def save_data():
    try:
        document_id = session["document_id"]
        values = request.json.get("data", [])
        service = get_service()
        sheet_title = session["sheet_title"]
        existing_values = read_sheet(service, document_id, sheet_title)
        old_height = len(existing_values)
        old_width = max((len(row) for row in existing_values), default=0)
        new_height = len(values)
        new_width = max((len(row) for row in values), default=0)
        if values:
            service.spreadsheets().values().update(
                spreadsheetId=document_id,
                range=f"'{sheet_title}'!A1",
                valueInputOption="USER_ENTERED",
                body={"values": values},
            ).execute()
        # Clear only cells which stopped being part of the user's table. This
        # preserves formatting, formulas, notes and data outside the edited area.
        stale_ranges = []
        if old_height > new_height and old_width:
            stale_ranges.append(f"'{sheet_title}'!A{new_height + 1}:{column_name(old_width)}{old_height}")
        if old_width > new_width and new_height:
            stale_ranges.append(f"'{sheet_title}'!{column_name(new_width + 1)}1:{column_name(old_width)}{min(old_height, new_height)}")
        for stale_range in stale_ranges:
            service.spreadsheets().values().clear(
                spreadsheetId=document_id, range=stale_range, body={}
            ).execute()
        return jsonify(ok=True, data=read_sheet(service, document_id, sheet_title))
    except KeyError:
        return jsonify(error="Niciun document încărcat."), 400
    except Exception as error:
        return api_error(error)


if __name__ == "__main__":
    preferred_port = int(os.environ.get("PORT", "5000"))
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", preferred_port))
            port = preferred_port
        except OSError:
            port = preferred_port + 1
    print(f"Server web disponibil la http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
