'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmtDate(d) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) }
function fmtFull(d) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }
function fmtMoney(n) { return '$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) }

function getPeriods(lastPayDate, count=8) {
  const periods = []
  const start = new Date(lastPayDate + 'T00:00:00')
  for (let i=0; i<count; i++) {
    const payDate = new Date(start)
    payDate.setDate(payDate.getDate() + i*14)
    const endDate = new Date(payDate)
    endDate.setDate(endDate.getDate()+13)
    endDate.setHours(23,59,59)
    periods.push({ payDate, endDate, isCurrent: i===0 })
  }
  return periods
}

function getBillsForPeriod(bills, period, periodIdx) {
  const result = []
  const p = period
  for (const bill of bills) {
    if (bill.due_each === 'biweekly') {
      result.push({...bill, dueDateLabel: fmtDate(p.payDate)+' (payday)', dueDate: p.payDate, periodKey: bill.id+'_bw'})
    } else if (bill.due_each === 'weekly' && bill.due_day_of_week !== null) {
      let d = new Date(p.payDate)
      while (d.getDay() !== bill.due_day_of_week) d.setDate(d.getDate()+1)
      let count = 0
      while (d <= p.endDate) {
        count++
        const dd = new Date(d)
        result.push({...bill, id: bill.id+'_w'+count, dueDateLabel: fmtDate(dd), dueDate: dd, periodKey: bill.id+'_'+p.payDate.toISOString().slice(0,10)+'_w'+count})
        d.setDate(d.getDate()+7)
      }
    } else if (bill.due_each === 'monthly') {
      const months = []
      let d = new Date(p.payDate); d.setDate(1)
      while(d<=p.endDate){months.push(new Date(d));d.setMonth(d.getMonth()+1)}
      for (const ms of months) {
        const dd = bill.due_day ? new Date(ms.getFullYear(),ms.getMonth(),bill.due_day) : new Date(p.payDate)
        if (dd>=p.payDate && dd<=p.endDate) {
          result.push({...bill, dueDateLabel:fmtDate(dd), dueDate:dd, periodKey:bill.id+'_'+ms.getFullYear()+'_'+(ms.getMonth()+1)})
        }
      }
    } else if (bill.due_each === 'once' && bill.due_date) {
      const dd = new Date(bill.due_date+'T00:00:00')
      if (dd>=p.payDate && dd<=p.endDate) {
        result.push({...bill, dueDateLabel:fmtDate(dd), dueDate:dd, periodKey:bill.id+'_once'})
      }
    }
  }
  return result.sort((a,b) => a.dueDate-b.dueDate)
}

const C = {
  bg: '#0a0c10', surface: '#111318', surface2: '#1a1d25',
  border: '#252830', borderBright: '#353845',
  text: '#e8eaf0', textMuted: '#6b7080', textDim: '#9ca3b0',
  green: '#00e5a0', greenDim: 'rgba(0,229,160,0.12)',
  red: '#ff4d6a', redDim: 'rgba(255,77,106,0.12)',
  yellow: '#ffc84a', yellowDim: 'rgba(255,200,74,0.12)',
  blue: '#4d9fff', blueDim: 'rgba(77,159,255,0.12)',
}

export default function Dashboard() {
  const [user, setUser] = useState(null)
  const [settings, setSettings] = useState(null)
  const [bills, setBills] = useState([])
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodIdx, setPeriodIdx] = useState(0)
  const [periods, setPeriods] = useState([])
  const [checkedMap, setCheckedMap] = useState({})
  const [balance, setBalance] = useState('')
  const [noteText, setNoteText] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([{role:'assistant',content:"Hey! I know your bills and paycheck. Ask me anything -- \"What if I add a car payment?\" or \"Am I on track with my savings goals?\""}])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [showAddBill, setShowAddBill] = useState(false)
  const [showAddGoal, setShowAddGoal] = useState(false)
  const [newBill, setNewBill] = useState({name:'',amount:'',due_each:'monthly',due_day:'',due_date:'',tag:'fixed',note:'',due_day_of_week:''})
  const [newGoal, setNewGoal] = useState({name:'',target_amount:'',target_date:'',emoji:'🎯'})
  const [importFile, setImportFile] = useState(null)
  const [importResults, setImportResults] = useState(null)
  const [importing, setImporting] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [showImportDetails, setShowImportDetails] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const chatEndRef = useRef(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/login'; return }
      setUser(user)
      const { data: s } = await supabase.from('planner_settings').select('*').eq('user_id', user.id).single()
      if (!s || !s.paycheck_amount) { window.location.href = '/dashboard'; return }
      setSettings(s)
      setBalance(s.current_balance?.toString() || '')
      const { data: b } = await supabase.from('bills').select('*').eq('user_id', user.id)
      setBills(b || [])
      const { data: g } = await supabase.from('savings_goals').select('*').eq('user_id', user.id)
      setGoals(g || [])
      const { data: checks } = await supabase.from('period_checks').select('*').eq('user_id', user.id)
      const cm = {}
      if (checks) checks.forEach(c => cm[c.check_key] = true)
      setCheckedMap(cm)
      const ps = getPeriods(s.last_pay_date)
      setPeriods(ps)
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (!periods.length || !user) return
    async function loadNote() {
      const { data } = await supabase.from('period_notes').select('note').eq('user_id', user.id).eq('period_key', 'p'+periodIdx).single()
      setNoteText(data?.note || '')
    }
    loadNote()
  }, [periodIdx, periods, user])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({behavior:'smooth'})
  }, [chatMessages])

  async function toggleCheck(key) {
    const newVal = !checkedMap[key]
    setCheckedMap(prev => ({...prev, [key]: newVal}))
    if (newVal) {
      await supabase.from('period_checks').upsert({user_id: user.id, check_key: key, checked: true})
    } else {
      await supabase.from('period_checks').delete().eq('user_id', user.id).eq('check_key', key)
    }
  }

  async function saveBalance(val) {
    setBalance(val)
    if (val && !isNaN(parseFloat(val))) {
      await supabase.from('planner_settings').update({current_balance: parseFloat(val)}).eq('user_id', user.id)
    }
  }

  async function saveNote() {
    await supabase.from('period_notes').upsert({user_id: user.id, period_key: 'p'+periodIdx, note: noteText})
  }

  async function addBill() {
    if (!newBill.name || !newBill.amount) return
    const bill = {
      user_id: user.id,
      name: newBill.name,
      amount: parseFloat(newBill.amount),
      due_each: newBill.due_each,
      due_day: newBill.due_day ? parseInt(newBill.due_day) : null,
      due_date: newBill.due_date || null,
      tag: newBill.tag,
      note: newBill.note,
      due_day_of_week: newBill.due_day_of_week !== '' ? parseInt(newBill.due_day_of_week) : null,
      keywords: [newBill.name.toLowerCase().substring(0,20)]
    }
    const { data } = await supabase.from('bills').insert(bill).select().single()
    if (data) setBills(prev => [...prev, data])
    setShowAddBill(false)
    setNewBill({name:'',amount:'',due_each:'monthly',due_day:'',due_date:'',tag:'fixed',note:'',due_day_of_week:''})
  }

  async function deleteBill(id) {
    await supabase.from('bills').delete().eq('id', id)
    setBills(prev => prev.filter(b => b.id !== id))
  }

  async function addGoal() {
    if (!newGoal.name || !newGoal.target_amount) return
    const goal = {
      user_id: user.id,
      name: newGoal.name,
      target_amount: parseFloat(newGoal.target_amount),
      target_date: newGoal.target_date || null,
      emoji: newGoal.emoji || '🎯',
      saved_amount: 0
    }
    const { data } = await supabase.from('savings_goals').insert(goal).select().single()
    if (data) setGoals(prev => [...prev, data])
    setShowAddGoal(false)
    setNewGoal({name:'',target_amount:'',target_date:'',emoji:'🎯'})
  }

  async function addToGoal(goalId, amount) {
    const goal = goals.find(g => g.id === goalId)
    if (!goal) return
    const newSaved = Math.min(goal.target_amount, goal.saved_amount + parseFloat(amount))
    await supabase.from('savings_goals').update({saved_amount: newSaved}).eq('id', goalId)
    setGoals(prev => prev.map(g => g.id === goalId ? {...g, saved_amount: newSaved} : g))
  }

  async function deleteGoal(id) {
    await supabase.from('savings_goals').delete().eq('id', id)
    setGoals(prev => prev.filter(g => g.id !== id))
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processImportFile(file)
  }

  async function processImportFile(file) {
    setImporting(true)
    setImportFile(file.name)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('bills', JSON.stringify(bills))
    formData.append('lastPayDate', settings?.last_pay_date || '')
    try {
      const res = await fetch('/api/import', {method:'POST', body: formData})
      const data = await res.json()
      if (data.matches) {
        const newChecked = {...checkedMap}
        for (const match of data.matches) {
          if (match.periodKey) {
            newChecked[match.periodKey] = true
            await supabase.from('period_checks').upsert({user_id: user.id, check_key: match.periodKey, checked: true})
          }
        }
        setCheckedMap(newChecked)
        setImportResults(data)
      }
    } catch(e) {
      console.error(e)
    }
    setImporting(false)
  }

  async function sendChat() {
    if (!chatInput.trim()) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatLoading(true)
    const newMessages = [...chatMessages, {role:'user', content:msg}]
    setChatMessages(newMessages)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          messages: newMessages.slice(-10),
          context: {
            paycheckAmount: settings?.paycheck_amount,
            payFrequency: settings?.pay_frequency,
            balance,
            bills,
            goals,
          }
        })
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, {role:'assistant', content: data.reply}])
    } catch(e) {
      setChatMessages(prev => [...prev, {role:'assistant', content:'Sorry, something went wrong.'}])
    }
    setChatLoading(false)
  }

  if (loading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',color:C.green,fontFamily:'monospace'}}>
      Loading your planner...
    </div>
  )

  const currentPeriod = periods[periodIdx]
  if (!currentPeriod) return null
  const periodBills = getBillsForPeriod(bills, currentPeriod, periodIdx)
  const bal = parseFloat(balance) || 0
  let paid = 0, unpaid = 0
  periodBills.forEach(b => {
    const key = 'p'+periodIdx+'_'+b.periodKey
    if (checkedMap[key]) paid += parseFloat(b.amount)
    else unpaid += parseFloat(b.amount)
  })
  const freeCash = bal
  const expected = bal - unpaid

  return (
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:'monospace',fontSize:'13px',padding:'32px 24px 80px'}}>

      {/* HEADER */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:'40px',paddingBottom:'24px',borderBottom:`1px solid ${C.border}`}}>
        <div>
          <h1 style={{fontFamily:'sans-serif',fontSize:'28px',fontWeight:'800',letterSpacing:'-0.5px',color:C.text,lineHeight:1}}>
            SAFE <span style={{color:C.green}}>//</span> SPLURGE
          </h1>
          <div style={{color:C.textMuted,fontSize:'11px',marginTop:'6px',letterSpacing:'0.08em',textTransform:'uppercase'}}>
            Bi-Weekly Period Planner
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{display:'inline-block',background:C.greenDim,border:`1px solid ${C.green}`,color:C.green,padding:'4px 12px',fontSize:'11px',letterSpacing:'0.1em',textTransform:'uppercase'}}>
            &#9679; Net {fmtMoney(settings.paycheck_amount)} / check
          </div>
          <div style={{color:C.textMuted,fontSize:'11px',marginTop:'6px'}}>
            Next paycheck: {fmtDate(periods[1]?.payDate || currentPeriod.payDate)}
          </div>
          <button onClick={async()=>{await supabase.auth.signOut();window.location.href='/login'}}
            style={{marginTop:'8px',background:'transparent',border:`1px solid ${C.border}`,color:C.textMuted,padding:'4px 10px',fontFamily:'monospace',fontSize:'10px',cursor:'pointer'}}>
            Sign Out
          </button>
        </div>
      </div>

      {/* PERIOD TABS */}
      <div style={{display:'flex',gap:'8px',marginBottom:'28px',flexWrap:'wrap'}}>
        {periods.map((p,i) => (
          <button key={i} onClick={()=>setPeriodIdx(i)} style={{
            background: i===periodIdx ? (p.isCurrent ? C.yellowDim : C.greenDim) : C.surface,
            border: `1px solid ${i===periodIdx ? (p.isCurrent ? C.yellow : C.green) : (p.isCurrent ? C.yellow : C.border)}`,
            color: i===periodIdx ? (p.isCurrent ? C.yellow : C.green) : (p.isCurrent ? C.yellow : C.textMuted),
            padding:'8px 16px',fontFamily:'monospace',fontSize:'11px',cursor:'pointer',letterSpacing:'0.05em'
          }}>
            {p.isCurrent ? 'NOW' : fmtDate(p.payDate)}{i===1?' (Next)':''}
          </button>
        ))}
      </div>

      {/* SUMMARY STRIP */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'12px',marginBottom:'28px'}}>
        {[
          {label:'Gross Income', val:fmtMoney(settings.paycheck_amount), color:C.green, sub:'This period'},
          {label:'Total Obligations', val:fmtMoney(periodBills.reduce((s,b)=>s+parseFloat(b.amount),0)), color:C.red, sub:'Due this period'},
          {label:'Checked Off', val:fmtMoney(paid), color:C.yellow, sub:'Marked as paid'},
        ].map(card => (
          <div key={card.label} style={{background:C.surface,border:`1px solid ${C.border}`,padding:'16px 18px',borderTop:`2px solid ${card.color}`}}>
            <div style={{fontSize:'10px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'8px'}}>{card.label}</div>
            <div style={{fontFamily:'sans-serif',fontSize:'22px',fontWeight:'700',lineHeight:1,color:card.color}}>{card.val}</div>
            <div style={{fontSize:'10px',color:C.textMuted,marginTop:'4px'}}>{card.sub}</div>
          </div>
        ))}
        <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'16px 18px',borderTop:`2px solid ${C.blue}`}}>
          <div style={{fontSize:'10px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'8px'}}>Current Balance</div>
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'4px'}}>
            <span style={{color:C.textMuted,fontSize:'13px'}}>$</span>
            <input type="number" value={balance} onChange={e=>saveBalance(e.target.value)} placeholder="0.00"
              style={{background:'transparent',border:'none',borderBottom:`1px solid ${C.borderBright}`,color:C.blue,fontFamily:'sans-serif',fontSize:'20px',fontWeight:'700',width:'100%',outline:'none',padding:'2px 0'}}/>
          </div>
          <div style={{fontSize:'10px',color:C.textMuted,marginTop:'4px'}}>Enter checking balance</div>
        </div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'16px 18px',borderTop:`2px solid ${balance?(freeCash<0?C.red:C.green):C.green}`}}>
          <div style={{fontSize:'10px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'8px'}}>Free Cash Flow</div>
          <div style={{fontFamily:'sans-serif',fontSize:'22px',fontWeight:'700',lineHeight:1,color:balance?(freeCash<0?C.red:C.green):C.textMuted}}>
            {balance ? fmtMoney(freeCash) : '--'}
          </div>
          <div style={{fontSize:'10px',color:C.textMuted,marginTop:'4px'}}>{fmtMoney(unpaid)} still due</div>
        </div>
      </div>

      {/* IMPORT ZONE */}
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={handleDrop}
        onClick={()=>fileInputRef.current?.click()}
        style={{border:`1px dashed ${dragOver?C.blue:C.borderBright}`,padding:'20px',textAlign:'center',cursor:'pointer',background:dragOver?C.blueDim:C.surface,marginBottom:'20px',transition:'all 0.2s'}}
      >
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}}
          onChange={e=>{if(e.target.files[0])processImportFile(e.target.files[0])}}/>
        <div style={{fontSize:'22px',marginBottom:'6px'}}>&#8681;</div>
        <div style={{fontSize:'11px',color:C.textMuted}}>
          Drop your bank statement <strong style={{color:C.blue}}>CSV or Excel export</strong> here, or click to browse
        </div>
        <div style={{fontSize:'11px',color:C.textMuted,marginTop:'8px'}}>
          {importing ? 'Matching transactions...' : importFile ? `Loaded: ${importFile}` : 'Accepts .csv, .xlsx, .xls \u2022 Transactions auto-matched to bills'}
        </div>
      </div>

      {/* IMPORT RESULTS */}
      {importResults && (
        <div style={{background:C.surface,border:`1px solid ${C.border}`,marginBottom:'20px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 18px',borderBottom:`1px solid ${C.border}`,background:'rgba(255,255,255,0.02)'}}>
            <div style={{fontFamily:'sans-serif',fontSize:'11px',fontWeight:'700',letterSpacing:'0.12em',textTransform:'uppercase',color:C.textDim}}>Import Results</div>
            <button onClick={()=>{setImportResults(null);setImportFile(null)}}
              style={{background:'transparent',border:`1px solid ${C.borderBright}`,color:C.textMuted,padding:'3px 10px',fontFamily:'monospace',fontSize:'10px',cursor:'pointer'}}>
              Clear
            </button>
          </div>
          <div style={{display:'flex',borderBottom:`1px solid ${C.border}`}}>
            {[
              {val:importResults.total, label:'Transactions', color:C.blue},
              {val:importResults.matched, label:'Bills Matched', color:C.green},
              {val:importResults.unmatched, label:'No Match', color:C.textMuted},
            ].map(s => (
              <div key={s.label} style={{flex:1,padding:'10px 16px',borderRight:`1px solid ${C.border}`}}>
                <div style={{fontFamily:'sans-serif',fontSize:'16px',fontWeight:'700',lineHeight:1,marginBottom:'3px',color:s.color}}>{s.val}</div>
                <div style={{color:C.textMuted,fontSize:'10px',letterSpacing:'0.08em'}}>{s.label}</div>
              </div>
            ))}
          </div>
          <button onClick={()=>setShowImportDetails(!showImportDetails)} style={{width:'100%',background:'transparent',border:'none',borderTop:`1px solid ${C.border}`,color:C.textMuted,padding:'8px',fontFamily:'monospace',fontSize:'10px',cursor:'pointer'}}>{showImportDetails ? 'Hide transaction details' : `Show transaction details (${importResults.results?.length || 0})`}</button>
{showImportDetails && <>
          {importResults.results?.filter(r=>r.matched||showUnmatched).slice(0,40).map((r,i) => (
            <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 90px 80px 60px',padding:'9px 18px',borderBottom:`1px solid ${C.border}`,gap:'10px',alignItems:'center',fontSize:'11px',background:r.matched?C.greenDim:'transparent',opacity:r.matched?1:0.5}}>
              <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {r.description}
                {r.matched && <small style={{display:'block',fontSize:'10px',color:C.textMuted}}>&#8594; {r.billName}</small>}
                {!r.matched && <small style={{display:'block',fontSize:'10px',color:C.textMuted}}>No bill match</small>}
              </div>
              <div style={{color:C.textMuted,fontSize:'10px'}}>{r.date}</div>
              <div style={{textAlign:'right',color:C.red}}>{r.amount}</div>
              <div style={{fontSize:'9px',padding:'2px 6px',textAlign:'center',background:r.matched?C.greenDim:'rgba(255,255,255,0.05)',color:r.matched?C.green:C.textMuted,border:`1px solid ${r.matched?'rgba(0,229,160,0.3)':C.border}`}}>
                {r.matched?'matched':'no match'}
              </div>
            </div>
          ))}
          <button onClick={()=>setShowUnmatched(!showUnmatched)}
            style={{width:'100%',background:'transparent',border:'none',borderTop:`1px solid ${C.border}`,color:C.textMuted,padding:'8px',fontFamily:'monospace',fontSize:'10px',cursor:'pointer'}}>
            {showUnmatched ? 'Hide unmatched' : 'Show unmatched transactions'}
          </button>
        </>}
        </div>
      )}

      {/* MAIN GRID */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:'20px',alignItems:'start'}}>
        <div>
          {/* PERIOD HEADER */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',gap:'10px'}}>
            <div style={{fontFamily:'sans-serif',fontSize:'16px',fontWeight:'700'}}>
              {fmtFull(currentPeriod.payDate)} <span style={{color:C.textMuted,fontWeight:'400',fontSize:'14px'}}>/</span> {fmtFull(currentPeriod.endDate)}
              {currentPeriod.isCurrent && <span style={{display:'inline-block',fontSize:'9px',padding:'2px 7px',background:C.yellowDim,color:C.yellow,border:'1px solid rgba(255,200,74,0.4)',letterSpacing:'0.1em',textTransform:'uppercase',verticalAlign:'middle',marginLeft:'10px'}}>Active</span>}
            </div>
            <button onClick={()=>setShowAddBill(true)}
              style={{background:C.greenDim,border:`1px solid ${C.green}`,color:C.green,padding:'6px 14px',fontFamily:'monospace',fontSize:'11px',cursor:'pointer',whiteSpace:'nowrap'}}>
              + Add Bill
            </button>
          </div>

          {/* BILL PANEL */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`}}>
            <div style={{display:'grid',gridTemplateColumns:'28px 1fr 80px 80px 60px',padding:'8px 18px',gap:'12px',fontSize:'10px',textTransform:'uppercase',letterSpacing:'0.1em',color:C.textMuted,borderBottom:`1px solid ${C.border}`,background:'rgba(255,255,255,0.015)'}}>
              <div></div><div>Bill</div><div style={{textAlign:'center'}}>Due</div><div style={{textAlign:'right'}}>Amount</div><div></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'28px 1fr 80px 80px 60px',alignItems:'center',padding:'12px 18px',borderBottom:`1px solid ${C.border}`,gap:'12px',background:C.greenDim}}>
              <div></div>
              <div style={{color:C.green,fontSize:'12px',fontWeight:'500'}}>&#8593; Paycheck</div>
              <div style={{textAlign:'center',fontSize:'11px',color:C.green}}>{fmtDate(currentPeriod.payDate)}</div>
              <div style={{textAlign:'right',color:C.green,fontFamily:'sans-serif',fontSize:'14px',fontWeight:'700'}}>{fmtMoney(settings.paycheck_amount)}</div>
              <div></div>
            </div>

            {periodBills.filter(b=>b.due_each==='biweekly'||b.due_each==='weekly').length > 0 && (
              <div style={{padding:'8px 18px',fontSize:'10px',letterSpacing:'0.12em',textTransform:'uppercase',color:C.textMuted,background:'rgba(255,255,255,0.02)',borderBottom:`1px solid ${C.border}`}}>Every Period</div>
            )}
            {periodBills.filter(b=>b.due_each==='biweekly'||b.due_each==='weekly').map(bill => {
              const key = 'p'+periodIdx+'_'+bill.periodKey
              const checked = !!checkedMap[key]
              return <BillRow key={key} bill={bill} checked={checked} onToggle={()=>toggleCheck(key)} onDelete={()=>deleteBill(bill.id)} C={C}/>
            })}

            {periodBills.filter(b=>b.due_each!=='biweekly'&&b.due_each!=='weekly').length > 0 && (
              <div style={{padding:'8px 18px',fontSize:'10px',letterSpacing:'0.12em',textTransform:'uppercase',color:C.textMuted,background:'rgba(255,255,255,0.02)',borderBottom:`1px solid ${C.border}`}}>Due This Period</div>
            )}
            {periodBills.filter(b=>b.due_each!=='biweekly'&&b.due_each!=='weekly').map(bill => {
              const key = 'p'+periodIdx+'_'+bill.periodKey
              const checked = !!checkedMap[key]
              return <BillRow key={key} bill={bill} checked={checked} onToggle={()=>toggleCheck(key)} onDelete={()=>deleteBill(bill.id)} C={C}/>
            })}

            {periodBills.length === 0 && (
              <div style={{padding:'24px 18px',color:C.textMuted,fontSize:'12px'}}>No bills due this period.</div>
            )}
          </div>

          {/* CASHFLOW BOXES */}
          <div style={{marginTop:'20px',display:'grid',gridTemplateColumns:'1fr 32px 1fr 32px 1fr',alignItems:'stretch'}}>
            <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'18px 20px',borderTop:`2px solid ${C.green}`}}>
              <div style={{fontSize:'10px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'8px'}}>
                Free Cash Flow <span style={{fontSize:'9px',opacity:0.7}}>RIGHT NOW</span>
              </div>
              <div style={{fontFamily:'sans-serif',fontSize:'26px',fontWeight:'800',lineHeight:1,marginBottom:'6px',color:balance?(freeCash<0?C.red:C.green):C.textMuted}}>
                {balance ? ((freeCash<0?'-':'')+fmtMoney(freeCash)) : '--'}
              </div>
              <div style={{fontSize:'10px',color:C.textMuted}}>Your current balance</div>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'sans-serif',fontSize:'22px',fontWeight:'700',color:C.borderBright,background:C.bg,borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}>&#8722;</div>
            <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'18px 20px',borderTop:`2px solid ${C.red}`}}>
              <div style={{fontSize:'10px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'8px'}}>Bills Left to Pay</div>
              <div style={{fontFamily:'sans-serif',fontSize:'26px',fontWeight:'800',lineHeight:1,marginBottom:'6px',color:C.red}}>{fmtMoney(unpaid)}</div>
              <div style={{fontSize:'10px',color:C.textMuted}}>{periodBills.filter(b=>!checkedMap['p'+periodIdx+'_'+b.periodKey]).length} bills remaining</div>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'sans-serif',fontSize:'22px',fontWeight:'700',color:C.borderBright,background:C.bg,borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}>=</div>
            <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'18px 20px',borderTop:`2px solid ${C.yellow}`}}>
              <div style={{fontSize:'10px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'8px'}}>
                Expected Remaining <span style={{fontSize:'9px',opacity:0.7}}>BEFORE NEXT CHECK</span>
              </div>
              <div style={{fontFamily:'sans-serif',fontSize:'26px',fontWeight:'800',lineHeight:1,marginBottom:'6px',color:balance?(expected<0?C.red:C.yellow):C.textMuted}}>
                {balance ? ((expected<0?'-':'')+fmtMoney(expected)) : '--'}
              </div>
              <div style={{fontSize:'10px',color:C.textMuted}}>Your landing point</div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>

          {/* SAVINGS GOALS */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingBottom:'14px',borderBottom:`1px solid ${C.border}`,marginBottom:'16px'}}>
              <div style={{fontFamily:'sans-serif',fontSize:'12px',fontWeight:'700',letterSpacing:'0.12em',textTransform:'uppercase',color:C.textDim}}>Savings Goals</div>
              <button onClick={()=>setShowAddGoal(true)}
                style={{background:'transparent',border:`1px solid ${C.border}`,color:C.textMuted,padding:'3px 8px',fontFamily:'monospace',fontSize:'10px',cursor:'pointer'}}>
                + Add
              </button>
            </div>
            {goals.length === 0 && (
              <div style={{color:C.textMuted,fontSize:'12px',textAlign:'center',padding:'12px 0'}}>No goals yet. Add one!</div>
            )}
            {goals.map(goal => (
              <GoalCard key={goal.id} goal={goal} onAdd={addToGoal} onDelete={deleteGoal} C={C} periods={periods}/>
            ))}
          </div>

          {/* PERIOD NOTES */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'16px 18px'}}>
            <div style={{fontFamily:'sans-serif',fontSize:'12px',fontWeight:'700',letterSpacing:'0.12em',textTransform:'uppercase',color:C.textDim,marginBottom:'12px',paddingBottom:'12px',borderBottom:`1px solid ${C.border}`}}>Period Notes</div>
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Notes for this period..."
              style={{width:'100%',background:C.surface2,border:`1px solid ${C.border}`,color:C.text,padding:'10px',fontFamily:'monospace',fontSize:'12px',resize:'vertical',minHeight:'80px',outline:'none',lineHeight:'1.6'}}/>
            <div style={{textAlign:'right',marginTop:'6px'}}>
              <button onClick={saveNote}
                style={{background:C.greenDim,border:`1px solid ${C.green}`,color:C.green,padding:'5px 12px',fontFamily:'monospace',fontSize:'10px',cursor:'pointer'}}>
                SAVE NOTE
              </button>
            </div>
          </div>

          {/* PERIOD SUMMARY */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`,padding:'16px 18px'}}>
            <div style={{fontFamily:'sans-serif',fontSize:'12px',fontWeight:'700',letterSpacing:'0.12em',textTransform:'uppercase',color:C.textDim,marginBottom:'12px'}}>Period Summary</div>
            {[
              {label:'Income', val:fmtMoney(settings.paycheck_amount), color:C.green},
              {label:'Total Bills', val:fmtMoney(periodBills.reduce((s,b)=>s+parseFloat(b.amount),0)), color:C.red},
              {label:'Paid', val:fmtMoney(paid), color:C.yellow},
              {label:'Remaining', val:fmtMoney(unpaid), color:C.blue},
            ].map(row => (
              <div key={row.label} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${C.border}`,fontSize:'12px'}}>
                <span style={{color:C.textMuted}}>{row.label}</span>
                <span style={{color:row.color,fontFamily:'sans-serif',fontWeight:'700'}}>{row.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ADD BILL MODAL */}
      {showAddBill && (
        <Modal title="Add Bill" onClose={()=>setShowAddBill(false)} C={C}>
          {[
            {label:'Name', el:<input value={newBill.name} onChange={e=>setNewBill(p=>({...p,name:e.target.value}))} placeholder="e.g. Netflix" style={inputStyle(C)}/>},
            {label:'Amount', el:<input type="number" value={newBill.amount} onChange={e=>setNewBill(p=>({...p,amount:e.target.value}))} placeholder="0.00" style={inputStyle(C)}/>},
            {label:'Frequency', el:(
              <select value={newBill.due_each} onChange={e=>setNewBill(p=>({...p,due_each:e.target.value}))} style={inputStyle(C)}>
                <option value="monthly">Monthly</option>
                <option value="biweekly">Every paycheck</option>
                <option value="weekly">Weekly (specific day)</option>
                <option value="once">One time</option>
              </select>
            )},
            newBill.due_each==='monthly' && {label:'Due Day of Month', el:<input type="number" value={newBill.due_day} onChange={e=>setNewBill(p=>({...p,due_day:e.target.value}))} placeholder="e.g. 15" min="1" max="31" style={inputStyle(C)}/>},
            newBill.due_each==='weekly' && {label:'Day of Week', el:(
              <select value={newBill.due_day_of_week} onChange={e=>setNewBill(p=>({...p,due_day_of_week:e.target.value}))} style={inputStyle(C)}>
                <option value="">Select day</option>
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=>(
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            )},
            newBill.due_each==='once' && {label:'Due Date', el:<input type="date" value={newBill.due_date} onChange={e=>setNewBill(p=>({...p,due_date:e.target.value}))} style={inputStyle(C)}/>},
            {label:'Category', el:(
              <select value={newBill.tag} onChange={e=>setNewBill(p=>({...p,tag:e.target.value}))} style={inputStyle(C)}>
                <option value="fixed">Fixed</option>
                <option value="sub">Subscription</option>
                <option value="joint">Joint</option>
              </select>
            )},
            {label:'Note (optional)', el:<input value={newBill.note} onChange={e=>setNewBill(p=>({...p,note:e.target.value}))} placeholder="e.g. your half" style={inputStyle(C)}/>},
          ].filter(Boolean).map(row => (
            <div key={row.label} style={{marginBottom:'12px'}}>
              <div style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'0.1em',color:C.textMuted,marginBottom:'5px'}}>{row.label}</div>
              {row.el}
            </div>
          ))}
          <button onClick={addBill} style={{width:'100%',background:C.greenDim,border:`1px solid ${C.green}`,color:C.green,padding:'10px',fontFamily:'monospace',fontSize:'12px',cursor:'pointer',marginTop:'4px'}}>
            ADD BILL
          </button>
        </Modal>
      )}

      {/* ADD GOAL MODAL */}
      {showAddGoal && (
        <Modal title="Add Savings Goal" onClose={()=>setShowAddGoal(false)} C={C}>
          {[
            {label:'Goal Name', el:<input value={newGoal.name} onChange={e=>setNewGoal(p=>({...p,name:e.target.value}))} placeholder="e.g. Emergency Fund" style={inputStyle(C)}/>},
            {label:'Target Amount', el:<input type="number" value={newGoal.target_amount} onChange={e=>setNewGoal(p=>({...p,target_amount:e.target.value}))} placeholder="e.g. 5000" style={inputStyle(C)}/>},
            {label:'Target Date (optional)', el:<input type="date" value={newGoal.target_date} onChange={e=>setNewGoal(p=>({...p,target_date:e.target.value}))} style={inputStyle(C)}/>},
            {label:'Emoji', el:<input value={newGoal.emoji} onChange={e=>setNewGoal(p=>({...p,emoji:e.target.value}))} placeholder="🎯" style={inputStyle(C)}/>},
          ].map(row => (
            <div key={row.label} style={{marginBottom:'12px'}}>
              <div style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'0.1em',color:C.textMuted,marginBottom:'5px'}}>{row.label}</div>
              {row.el}
            </div>
          ))}
          <button onClick={addGoal} style={{width:'100%',background:C.greenDim,border:`1px solid ${C.green}`,color:C.green,padding:'10px',fontFamily:'monospace',fontSize:'12px',cursor:'pointer',marginTop:'4px'}}>
            ADD GOAL
          </button>
        </Modal>
      )}

      {/* CHAT FAB */}
      <button onClick={()=>setChatOpen(!chatOpen)}
        style={{position:'fixed',bottom:'28px',right:'28px',width:'52px',height:'52px',background:C.green,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',zIndex:100,boxShadow:'0 4px 24px rgba(0,229,160,0.3)'}}>
        &#129302;
      </button>

      {/* CHAT PANEL */}
      {chatOpen && (
        <div style={{position:'fixed',bottom:'92px',right:'28px',width:'380px',maxHeight:'520px',background:C.surface,border:`1px solid ${C.borderBright}`,display:'flex',flexDirection:'column',zIndex:99,boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}>
          <div style={{padding:'14px 18px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',background:C.surface2}}>
            <div>
              <div style={{fontFamily:'sans-serif',fontSize:'13px',fontWeight:'700',color:C.green}}>&#9679; Planner Assistant</div>
              <div style={{fontSize:'10px',color:C.textMuted,marginTop:'2px'}}>Knows your full financial picture</div>
            </div>
            <button onClick={()=>setChatOpen(false)} style={{background:'transparent',border:'none',color:C.textMuted,cursor:'pointer',fontSize:'18px'}}>&#215;</button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:'12px',maxHeight:'340px'}}>
            {chatMessages.map((m,i) => (
              <div key={i} style={{fontSize:'12px',lineHeight:'1.6',textAlign:m.role==='user'?'right':'left'}}>
                <div style={{fontSize:'9px',letterSpacing:'0.1em',textTransform:'uppercase',color:C.textMuted,marginBottom:'4px'}}>{m.role==='user'?'You':'Assistant'}</div>
                <div style={{display:'inline-block',padding:'8px 12px',maxWidth:'85%',textAlign:'left',background:m.role==='user'?C.greenDim:C.surface2,border:`1px solid ${m.role==='user'?'rgba(0,229,160,0.2)':C.border}`}}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && <div style={{fontSize:'11px',color:C.textMuted,fontStyle:'italic'}}>Thinking...</div>}
            <div ref={chatEndRef}/>
          </div>
          <div style={{display:'flex',gap:'8px',padding:'12px 16px',borderTop:`1px solid ${C.border}`}}>
            <textarea value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}}}
              placeholder="Ask about your finances..."
              style={{flex:1,background:C.surface2,border:`1px solid ${C.border}`,color:C.text,padding:'8px 10px',fontFamily:'monospace',fontSize:'12px',outline:'none',resize:'none',minHeight:'36px',maxHeight:'80px'}}/>
            <button onClick={sendChat} disabled={chatLoading}
              style={{background:C.greenDim,border:`1px solid ${C.green}`,color:C.green,padding:'8px 14px',fontFamily:'monospace',fontSize:'11px',cursor:'pointer',alignSelf:'flex-end'}}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BillRow({bill, checked, onToggle, onDelete, C}) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'28px 1fr 80px 80px 60px',alignItems:'center',padding:'10px 18px',borderBottom:`1px solid ${C.border}`,gap:'12px',opacity:checked?0.5:1,background:checked?'rgba(255,255,255,0.01)':'transparent'}}>
      <button onClick={onToggle} style={{width:'18px',height:'18px',border:`1px solid ${checked?C.green:C.borderBright}`,background:checked?C.green:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
        {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#0a0c10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </button>
      <div style={{color:C.text,fontSize:'12px',textDecoration:checked?'line-through':'none'}}>
        {bill.name}
        <span style={{display:'inline-block',fontSize:'9px',padding:'1px 5px',marginLeft:'6px',background:bill.tag==='sub'?'rgba(255,200,74,0.15)':bill.tag==='joint'?'rgba(0,229,160,0.15)':'rgba(77,159,255,0.15)',color:bill.tag==='sub'?C.yellow:bill.tag==='joint'?C.green:C.blue,textTransform:'uppercase',verticalAlign:'middle'}}>{bill.tag}</span>
        {bill.note && <div style={{fontSize:'10px',color:C.textMuted,marginTop:'2px'}}>{bill.note}</div>}
      </div>
      <div style={{color:C.textMuted,fontSize:'11px',textAlign:'center'}}>{bill.dueDateLabel}</div>
      <div style={{textAlign:'right',color:C.text,fontSize:'12px'}}>{fmtMoney(bill.amount)}</div>
      <div style={{textAlign:'right',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'4px'}}>
        <span style={{display:'inline-block',width:'6px',height:'6px',borderRadius:'50%',background:checked?C.green:C.yellow}}></span>
        <button onClick={onDelete} style={{background:'transparent',border:'none',color:C.textMuted,cursor:'pointer',fontSize:'12px',padding:'0 2px',lineHeight:1}}>&#10005;</button>
      </div>
    </div>
  )
}

function GoalCard({goal, onAdd, onDelete, C, periods}) {
  const [addAmount, setAddAmount] = useState('')
  const pct = Math.min(100, (goal.saved_amount / goal.target_amount) * 100)
  const remaining = goal.target_amount - goal.saved_amount
  const checksLeft = periods.length
  const neededPerCheck = checksLeft > 0 ? Math.max(0, remaining / checksLeft) : 0

  return (
    <div style={{marginBottom:'16px',paddingBottom:'16px',borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:'flex',gap:'12px',alignItems:'center',marginBottom:'12px'}}>
        <div style={{width:'40px',height:'40px',background:C.redDim,border:`1px solid ${C.red}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',flexShrink:0}}>
          {goal.emoji}
        </div>
        <div style={{flex:1}}>
          <div style={{fontFamily:'sans-serif',fontWeight:'700',fontSize:'13px',marginBottom:'2px'}}>{goal.name}</div>
          <div style={{color:C.textMuted,fontSize:'11px'}}>
            Target: {goal.target_date ? new Date(goal.target_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'}) : 'No date'} &bull; {fmtMoney(goal.target_amount)}
          </div>
        </div>
        <button onClick={()=>onDelete(goal.id)} style={{background:'transparent',border:'none',color:C.textMuted,cursor:'pointer',fontSize:'14px'}}>&#10005;</button>
      </div>
      <div style={{height:'6px',background:C.border,overflow:'hidden',marginBottom:'8px'}}>
        <div style={{height:'100%',background:`linear-gradient(90deg, ${C.red}, #ff8099)`,width:`${pct}%`,transition:'width 0.6s ease'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:C.textMuted,marginBottom:'10px'}}>
        <span>Saved: <span style={{color:C.text}}>{fmtMoney(goal.saved_amount)}</span></span>
        <span>Left: <span style={{color:C.text}}>{fmtMoney(remaining)}</span></span>
      </div>
      <div style={{display:'flex',gap:'8px'}}>
        <input type="number" value={addAmount} onChange={e=>setAddAmount(e.target.value)} placeholder="Add amount..."
          style={{flex:1,background:C.surface2,border:`1px solid ${C.border}`,color:C.text,padding:'7px 10px',fontFamily:'monospace',fontSize:'12px',outline:'none'}}/>
        <button onClick={()=>{if(addAmount){onAdd(goal.id,addAmount);setAddAmount('')}}}
          style={{background:C.redDim,border:`1px solid ${C.red}`,color:C.red,padding:'7px 12px',fontFamily:'monospace',fontSize:'11px',cursor:'pointer'}}>
          + Add
        </button>
      </div>
      <div style={{marginTop:'8px',fontSize:'10px',color:C.textMuted}}>
        ~{checksLeft} checks left &bull; Need {fmtMoney(neededPerCheck)}/check
      </div>
    </div>
  )
}

function Modal({title, onClose, children, C}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:C.surface,border:`1px solid ${C.borderBright}`,padding:'28px',width:'400px',maxWidth:'90vw',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{fontFamily:'sans-serif',fontSize:'16px',fontWeight:'700',marginBottom:'20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          {title}
          <button onClick={onClose} style={{background:'transparent',border:'none',color:C.textMuted,fontSize:'18px',cursor:'pointer'}}>&#10005;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function inputStyle(C) {
  return {width:'100%',background:C.surface2,border:`1px solid ${C.border}`,color:C.text,padding:'8px 10px',fontFamily:'monospace',fontSize:'12px',outline:'none'}
}