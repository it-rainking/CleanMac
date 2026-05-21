# 📋 CleanMac - Backlog & Roadmap

Questo documento traccia le funzionalità future e i miglioramenti pianificati per CleanMac.

---

## 🎯 NICE-TO-HAVE - Funzionalità Future

### 5. Integrazione Tool Visuali ⭐
**Priorità**: Bassa
**Effort**: Minimo
**Descrizione**: Suggerimento automatico per tool di analisi profonda

**Implementazione**:
- Aggiungere link a **DaisyDisk** e **GrandPerspective** nel report HTML
- Dialog suggerimento se "System Data" > 100GB dopo pulizia
- Link download diretti nel footer del report

**Benefici**:
- Aiuta utenti a identificare spazio nascosto
- Complementare alle funzionalità CleanMac

---

### 6. Promemoria Time Machine ⭐
**Priorità**: Media
**Effort**: Basso
**Descrizione**: Alert se backup Time Machine non recenti

**Implementazione**:
```bash
# Check ultimo backup TM
tmutil latestbackup
# Se > 7 giorni, mostra alert
```

**Features**:
- Warning se nessun backup negli ultimi 7 giorni
- Suggerimento attivazione/disattivazione TM
- Link a Preferenze Sistema Time Machine

**Benefici**:
- Previene perdita dati
- Aiuta a gestire snapshot locali

---

### 7. Ottimizzazione Storage macOS ⭐
**Priorità**: Media
**Effort**: Medio
**Descrizione**: Verifica e suggerimenti impostazioni Storage

**Implementazione**:
- Check impostazioni `System Settings → Storage`
- Verifica "Optimize Storage" attivo
- Suggerimento "Empty Trash Automatically"
- Link diretto alle Preferenze

**Features**:
```bash
# Verifica impostazioni storage via defaults
defaults read com.apple.desktop OptimizeStorage
```

**Benefici**:
- Configurazione ottimale macOS
- Prevenzione riempimento disco

---

### 8. Verifica File System (Opzionale)
**Priorità**: Bassa
**Effort**: Basso
**Descrizione**: Verifica integrità disco (solo su richiesta)

**Implementazione**:
```bash
# Solo se esplicitamente richiesto
diskutil verifyVolume /
```

**Note**:
- **Non eseguire di default** (OnyX lo sconsiglia)
- Solo se utente ha problemi disco
- Aggiungere come operazione opzionale 30

**Benefici**:
- Diagnostica problemi filesystem
- Completezza tool manutenzione

---

### 9. Pulizia Mail Indexes
**Priorità**: Bassa
**Effort**: Basso
**Descrizione**: Cache Mail.app (solo se utilizzata)

**Implementazione**:
```bash
# Cache Mail.app
~/Library/Mail/V*/MailData/Envelope Index*
# Verifica prima se Mail.app è usata
```

**Features**:
- Check se Mail.app installata e usata
- Calcolo dimensione indici
- Ricostruzione automatica dopo pulizia

**Benefici**:
- Libera 500MB-2GB
- Risolve lentezza Mail.app

---

### 10. Schedulazione Automatica
**Priorità**: Bassa (già scartato in roadmap, ma rilevante)
**Effort**: Alto
**Descrizione**: Esecuzione periodica automatica

**Implementazione**:
```xml
<!-- LaunchAgent plist -->
~/Library/LaunchAgents/com.cleanmac.weekly.plist
```

**Features**:
- Esecuzione settimanale/mensile automatica
- Solo Dry Run (sicurezza)
- Notifica risultati via Notification Center
- Report automatico via email (opzionale)

**Note**:
- Già scartato in CLAUDE.md, ma utenti enterprise potrebbero richiederlo
- Richiede configurazione avanzata
- Risk: esecuzione non supervisionata

---

## 🔄 MIGLIORAMENTI IMPLEMENTATI

### ✅ v4.1 (2025-12-31)
**Dalla trascrizione "System Data Analysis":**

| Funzionalità | Stato | Note |
|--------------|-------|------|
| Time Machine Snapshots | ✅ Implementato | Op. 27 - Libera 20-80GB |
| Backup iOS/iPad | ✅ Implementato | Op. 28 - Con conferma utente |
| Swap/Sleepimage | ✅ Implementato | Op. 29 - Solo analisi + suggerimenti |
| Xcode Archives | ✅ Implementato | Op. 6 estesa - Aggiunto Archives |
| CoreSimulator | ✅ Implementato | Op. 6 estesa - Aggiunto Simulator |

---

## 📊 CONFRONTO METODOLOGIE

Comparazione con approccio manuale dalla trascrizione:

| Elemento | Manuale (Trascrizione) | CleanMac v4.1 | Vantaggio CleanMac |
|----------|------------------------|---------------|-------------------|
| **TM Snapshots** | `tmutil thinlocalsnapshots` manuale | ✅ Automatico + stima spazio | Calcolo automatico |
| **Backup iOS** | Finder → Delete manuale | ✅ Automatico + conferma | Sicurezza dati |
| **Swap** | `ls -lh /var/vm` + riavvio | ✅ Analisi + suggerimenti smart | Azione consigliata |
| **Xcode Archives** | `rm -rf` manuale | ✅ Calcolo + pulizia sicura | Tracking spazio |
| **CoreSimulator** | `rm -rf` manuale | ✅ Inclusione automatica | Nessun comando da ricordare |
| **Cache Sistema** | Manuale OnyX | ✅ Automatico 26 operazioni | Workflow completo |
| **Spotlight** | Rebuild manuale | ✅ Automatico in batch | Integrato nel flusso |

**Risultato**: CleanMac v4.1 automatizza 100% delle operazioni manuali della trascrizione.

---

## 🚧 FUNZIONALITÀ IN VALUTAZIONE

### A. Plugin System
**Descrizione**: Architettura plugin per operazioni personalizzate

**Pro**:
- Estensibilità infinita
- Community-driven development
- Personalizzazione enterprise

**Contro**:
- Complessità architettura
- Rischi sicurezza (plugin di terze parti)
- Manutenzione extra

**Decisione**: ⏸️ In pausa - valutare se richiesto da utenti

---

### B. Interfaccia Grafica nativa (SwiftUI)
**Descrizione**: App macOS nativa invece di CLI/Web

**Pro**:
- UX nativa macOS
- Integrazione Preferenze Sistema
- Firma codice e distribuzione App Store

**Contro**:
- Riscrittura completa
- Effort elevato (200+ ore)
- Manutenzione doppia (CLI + GUI)

**Decisione**: ❌ Non prioritario - Web Interface v1.1 soddisfa il bisogno

---

### C. Machine Learning per raccomandazioni
**Descrizione**: AI per suggerire cosa eliminare basandosi su pattern

**Pro**:
- Smart suggestions
- Apprendimento da comportamento utente
- Wow factor

**Contro**:
- Over-engineering
- Rischi privacy
- Complessità eccessiva

**Decisione**: ❌ Out of scope - CleanMac è un tool di manutenzione, non AI

---

## 📈 METRICHE DI SUCCESSO

### Obiettivi v4.1 ✅
- [x] Liberare 35-160 GB aggiuntivi vs v4.0
- [x] Ridurre "System Data" invisibile
- [x] Zero perdita dati (conferme per operazioni critiche)
- [x] 29 operazioni automatiche

### Obiettivi v5.0 (Future)
- [ ] 35+ operazioni
- [ ] Integrazione tool esterni (DaisyDisk, OnyX)
- [ ] Report CSV/JSON export
- [ ] Plugin system (TBD)

---

## 💡 IDEE DALLA COMMUNITY

_Sezione per tracciare richieste utenti e feedback_

**Template**:
```markdown
### [TITOLO RICHIESTA]
**Richiesto da**: [nome/issue]
**Data**: YYYY-MM-DD
**Descrizione**: ...
**Priorità**: Alta/Media/Bassa
**Status**: In valutazione / Accettato / Rifiutato
```

---

## 📝 NOTE FINALI

**Filosofia CleanMac**:
1. **Semplicità** - Nessuna configurazione complessa
2. **Sicurezza** - Conferme per operazioni critiche
3. **Trasparenza** - Report dettagliati sempre
4. **Efficacia** - Massimo spazio liberato con minimo effort

**Prossimi Step**:
1. Monitorare feedback utenti v4.1
2. Valutare implementazione nice-to-have basandosi su richieste
3. Mantenere backlog aggiornato

---

**Ultimo aggiornamento**: 2025-12-31
**Versione CleanMac**: v4.1
**Operazioni totali**: 29
