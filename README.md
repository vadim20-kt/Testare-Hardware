# Sheetly

Sheetly este o aplicație web construită în Python cu Flask, destinată lucrului direct cu documente Google Sheets. Aplicația permite autentificarea prin Google OAuth, deschiderea unui spreadsheet, editarea datelor și gestionarea foilor dintr-o interfață modernă.

## Features

- autentificare OAuth Google;
- deschidere și lucru direct într-un document Google Sheets;
- selectare între mai multe foi ale documentului;
- editare celulelor și anteturi;
- adăugare și ștergere de rânduri și coloane;
- creare și ștergere de foi;
- salvare manuală prin butonul Save sau tastatura Ctrl+S;
- import CSV din fișier local;
- export al foii active în format CSV;
- inserare rapidă de tabele și scheme de proces;
- încărcare imagini în Drive și inserare în celula selectată prin formula `IMAGE()`;
- reîncărcare manuală din Google Sheets pentru a vedea modificările făcute de alți colaboratori.

## Project structure

```text
web_app.py             backend Flask și integrare Google Sheets / Drive
templates/index.html   interfață principală
static/app.js          logica frontend și interacțiuni browser
static/style.css       stilizare UI
requirements.txt       dependențe Python
credentials.json       fișier OAuth local (nu se publică)
token.json             token de autentificare local (nu se publică)
.gitignore             exclude fișiere sensibile și cache-uri locale
```

## Requirements

- Python 3.10+
- un proiect Google Cloud cu API-uri activate:
  - Google Sheets API
  - Google Drive API
- un OAuth Client ID de tip Web application

## Local setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python web_app.py
```

După pornire, deschide în browser:

```text
http://127.0.0.1:5000
```

## Google OAuth configuration

1. Intră în Google Cloud Console.
2. Activează Google Sheets API și Google Drive API.
3. Creează un OAuth Client ID de tip Web application.
4. Adaugă redirect URI-ul:

```text
http://127.0.0.1:5000/oauth2callback
```

5. Descarcă fișierul JSON de autentificare și salvează-l ca `credentials.json` în rădăcina proiectului.
6. Pornește aplicația și apasă pe butonul `Conectează Google`.

După autorizare, aplicația va crea automat `token.json` pentru sesiunea locală.

> Atât `credentials.json`, cât și `token.json` conțin date sensibile și nu trebuie publicate pe GitHub.

## Security notes

- nu încărca niciodată `credentials.json` sau `token.json` într-un repository public;
- pentru deployment în producție: folosește HTTPS și setează o variabilă sigură pentru `FLASK_SECRET_KEY`;
- dacă tokenul expiră sau permisiunile sunt revocate, reconectează aplicația din interfață.

## Supported links

Aplicația acceptă linkuri de tip:

```text
https://docs.google.com/spreadsheets/d/...
```

## License

Proiectul este destinat în principal pentru demonstrație și dezvoltare locală în cadrul unui proiect de studiu.
