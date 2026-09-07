# Sheetly

Editor web modern pentru Google Sheets. Aplicația lucrează direct în documentul Google selectat, cu autosalvare și instrumente rapide pentru organizarea datelor.

## Funcții

- autentificare OAuth Google și selectare de foi din document;
- editare directă a celulelor, inclusiv anteturi;
- adăugare și ștergere de rânduri sau coloane;
- creare și ștergere de foi;
- salvare manuală prin butonul **Salvează** sau `Ctrl+S`;
- import CSV local și export CSV al foii active;
- inserare rapidă de tabele și scheme de proces;
- încărcare imagini de până la 8 MB: imaginea este încărcată în Drive și introdusă în celula selectată prin formula Google Sheets `IMAGE()`;
- reîncărcare manuală din Google Sheets prin butonul **Reîncarcă**, utilă după modificări făcute de alți colaboratori.

## Structura proiectului

```text
web_app.py             serverul Flask și integrarea Google Sheets/Drive
templates/index.html   structura interfeței
static/app.js          funcționalitatea din browser
static/style.css       designul aplicației
requirements.txt       dependențele Python necesare
credentials.json       configurarea OAuth locală (nu se publică)
token.json             autorizarea locală (nu se publică)
```

## Instalare și rulare

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python web_app.py
```

Deschide adresa afișată în terminal, de regulă `http://127.0.0.1:5000`.

## Configurare Google OAuth

1. Activează Google Sheets API și Google Drive API în Google Cloud Console.
2. Creează un OAuth Client ID de tip **Web application**.
3. Adaugă redirect URI-ul `http://127.0.0.1:5000/oauth2callback`.
4. Descarcă fișierul OAuth și salvează-l ca `credentials.json` în rădăcina proiectului.
5. Pornește aplicația și apasă **Conectează Google**.

După autorizare, `token.json` este creat automat. Ambele fișiere conțin date sensibile și sunt ignorate prin `.gitignore`; nu le publica.

## Observații

- Pentru rulare publică folosește HTTPS și setează o valoare aleatoare pentru `FLASK_SECRET_KEY`.
- Dacă permisiunile au fost revocate sau tokenul a expirat, reconectează contul din aplicație.
- Aplicația acceptă linkuri `docs.google.com/spreadsheets/d/...`.
