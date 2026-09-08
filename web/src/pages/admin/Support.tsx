import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Empty, Field, Pill, Select, Textarea, useToast } from '@/components/ui'
import { Icon } from '@/components/Icon'
import {
  TICKET_STATUSES, loadPlatformTickets, platformReply, platformSetTicketStatus,
} from '@/data/support'
import type { PlatformTicket, TicketPriority, TicketStatus } from '@/data/support'

/* La boîte de réception du support, côté plateforme.
   En français en dur, comme le reste de la console : elle n'a qu'un lecteur.

   Ce que cet écran NE MONTRE PAS, et c'est le point : les données de l'agence.
   Un ticket porte une question et un fil, pas un client, pas un dossier, pas un
   montant. Pour regarder la donnée, il faut ouvrir l'agence en vue support
   depuis la liste des agences, et cette ouverture est journalisée. Une porte de
   plus ici viderait ce journal de son sens.

   L'ordre de la file vient du serveur : l'urgent d'abord, puis le plus vieux
   sans réponse. C'est l'ordre dans lequel une file se traite. Re-trier ici
   ferait diverger l'écran de ce que la base considère comme prioritaire. */

const STATUS_LABEL: Record<TicketStatus, string> = {
  ouvert: 'Ouverte',
  pris_en_charge: 'Prise en charge',
  en_attente_client: 'En attente du client',
  resolu: 'Résolue',
  ferme: 'Fermée',
}

const STATUS_TONE: Record<TicketStatus, 'blue' | 'orange' | 'green' | 'gray'> = {
  ouvert: 'blue', pris_en_charge: 'orange', en_attente_client: 'orange',
  resolu: 'green', ferme: 'gray',
}

const PRIO_LABEL: Record<TicketPriority, string> = {
  basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente',
}

const PRIO_TONE: Record<TicketPriority, 'gray' | 'orange' | 'red'> = {
  basse: 'gray', normale: 'gray', haute: 'orange', urgente: 'red',
}

const CAT_LABEL: Record<string, string> = {
  question: 'Question', anomalie: 'Anomalie', demande: 'Demande',
  facturation: 'Facturation', urgence: 'Urgence',
}

type Filter = 'actifs' | 'tous' | TicketStatus

export function SupportInbox() {
  const toast = useToast()
  const [rows, setRows] = useState<PlatformTicket[]>([])
  const [filter, setFilter] = useState<Filter>('actifs')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try { setRows(await loadPlatformTickets(null)) } catch (e) { toast((e as Error).message) }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const actifs: TicketStatus[] = ['ouvert', 'pris_en_charge', 'en_attente_client']
  const shown = rows.filter((r) =>
    filter === 'tous' ? true
      : filter === 'actifs' ? actifs.includes(r.status)
        : r.status === filter)

  const open = rows.find((r) => r.id === openId) ?? null
  const enAttente = rows.filter((r) => r.status === 'ouvert').length

  const reply = async () => {
    if (!open || !draft.trim()) return
    setBusy(true)
    try {
      await platformReply(open.id, draft.trim())
      setDraft('')
      await load()
      toast('Réponse envoyée.')
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  const setStatus = async (id: string, status: TicketStatus) => {
    setBusy(true)
    try {
      await platformSetTicketStatus(id, status)
      await load()
      toast('État mis à jour.')
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card
      title={`Support${enAttente ? ` · ${enAttente} sans réponse` : ''}`}
      action={
        <div className="row gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="actifs">À traiter</option>
            <option value="tous">Tous</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Button icon="refresh" onClick={() => void load()}>Rafraîchir</Button>
        </div>
      }
      flush
    >
      {shown.length === 0 ? (
        <div style={{ padding: 'var(--sp-6)' }}><Empty title="Aucune demande." /></div>
      ) : (
        <div className="admin__scroll">
          <table className="admin__table">
            <thead>
              <tr>
                <th>Agence</th><th>Sujet</th><th>Nature</th><th>Urgence</th>
                <th>État</th><th className="num">Messages</th><th>Dernier échange</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="col">
                      <span className="t-medium t-small">{r.agency_name}</span>
                      <span className="t-caption t-tertiary">{r.agency_slug} · {r.agency_plan}</span>
                    </div>
                  </td>
                  <td className="t-small">{r.subject}</td>
                  <td className="t-caption t-secondary">{CAT_LABEL[r.category] ?? r.category}</td>
                  <td><Pill tone={PRIO_TONE[r.priority]}>{PRIO_LABEL[r.priority]}</Pill></td>
                  <td><Pill tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status]}</Pill></td>
                  <td className="num">{r.messages}</td>
                  <td className="t-caption t-tertiary">
                    {/* Qui a parlé en dernier vaut tri visuel : une agence qui a
                        répondu la dernière attend une réponse, pas l'inverse. */}
                    {r.last_kind === 'agence' ? '↩ agence · ' : ''}
                    {new Date(r.updated_at).toLocaleDateString('fr-TN')}
                  </td>
                  <td>
                    <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                      <Button icon="messages" onClick={() => { setOpenId(r.id === openId ? null : r.id); setDraft('') }}>
                        {r.id === openId ? 'Fermer' : 'Ouvrir'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="col gap-4" style={{ padding: 'var(--sp-5) var(--sp-6)', borderTop: '1px solid var(--hairline)' }}>
          <div className="row gap-3 wrap">
            <span className="t-medium">{open.subject}</span>
            <Pill tone={PRIO_TONE[open.priority]}>{PRIO_LABEL[open.priority]}</Pill>
            <Pill tone={STATUS_TONE[open.status]} dot>{STATUS_LABEL[open.status]}</Pill>
            <span className="grow" />
            <Select
              value={open.status}
              onChange={(e) => void setStatus(open.id, e.target.value as TicketStatus)}
              disabled={busy}
            >
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </div>

          <div className="col gap-3">
            {open.thread.map((m) => {
              const nous = m.author_kind === 'plateforme'
              return (
                <div
                  key={m.id}
                  className="col gap-1"
                  style={{
                    padding: 'var(--sp-3) var(--sp-4)',
                    borderRadius: 'var(--radius-md, 10px)',
                    background: nous ? 'var(--tint-blue, rgba(0,102,204,.08))' : 'var(--surface-sunken, rgba(0,0,0,.04))',
                  }}
                >
                  <span className="row gap-2">
                    <Icon name={nous ? 'shield' : 'building'} size={14} />
                    <span className="t-caption t-medium">{nous ? 'Nous' : open.agency_name}</span>
                    <span className="grow" />
                    <span className="t-caption t-tertiary">
                      {new Date(m.at).toLocaleString('fr-TN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  <span className="t-small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
                </div>
              )
            })}
          </div>

          {open.status !== 'ferme' && (
            <>
              <Field label="Votre réponse">
                <Textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
              </Field>
              <div className="row gap-2">
                <span className="grow" />
                <Button variant="primary" icon="mail" disabled={busy || !draft.trim()} onClick={() => void reply()}>
                  Envoyer
                </Button>
              </div>
            </>
          )}

          <p className="t-caption t-tertiary">
            Ce fil ne donne accès à aucune donnée de l’agence. Pour regarder un dossier,
            ouvrez l’agence en vue support depuis la liste des agences : l’accès y est journalisé.
          </p>
        </div>
      )}
    </Card>
  )
}
