import { NextResponse } from 'next/server'

function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g,'').toLowerCase())
  return lines.slice(1).map(line => {
    const cols = splitCSV(line)
    const obj = {}
    header.forEach((h,i) => obj[h] = (cols[i]||'').replace(/"/g,'').trim())
    return normalizeRow(obj)
  }).filter(r => r && r.description)
}

function splitCSV(line) {
  const result = []; let cur = '', inQ = false
  for (const c of line) {
    if (c==='"') inQ=!inQ
    else if (c===','&&!inQ) { result.push(cur); cur='' }
    else cur+=c
  }
  result.push(cur); return result
}

function normalizeRow(obj) {
  const description = obj['description'] || obj['memo'] || ''
  if (!description) return null
  const dateStr = obj['posting date'] || obj['post date'] || obj['transaction date'] || obj['date'] || ''
  const amount = parseFloat(String(obj['amount']||'0').replace(/[^0-9.\-]/g,'')) || 0
  let date = null
  if (dateStr) { const d = new Date(dateStr); if (!isNaN(d.getTime())) date = d }
  return { description: description.trim(), amount, date }
}

function fmtDate(d) {
  if (!d) return '--'
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})
}

function fmtMoney(n) {
  return '$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
}

function getPeriods(lastPayDate, count=12) {
  const periods = []
  const start = new Date(lastPayDate + 'T00:00:00')
  for (let i=0; i<count; i++) {
    const payDate = new Date(start)
    payDate.setDate(payDate.getDate() + i*14)
    const endDate = new Date(payDate)
    endDate.setDate(endDate.getDate()+13)
    endDate.setHours(23,59,59)
    periods.push({ payDate, endDate, idx: i })
  }
  return periods
}

function findPeriodForDate(date, periods) {
  if (!date) return -1
  for (const p of periods) {
    if (date >= p.payDate && date <= p.endDate) return p.idx
  }
  return -1
}

function getBillsForPeriod(bills, period) {
  const result = []
  const p = period
  for (const bill of bills) {
    if (bill.due_each === 'biweekly') {
      result.push({...bill, periodKey: bill.id+'_bw', dueDate: p.payDate})
    } else if (bill.due_each === 'weekly' && bill.due_day_of_week !== null) {
      let d = new Date(p.payDate)
      while (d.getDay() !== bill.due_day_of_week) d.setDate(d.getDate()+1)
      let count = 0
      while (d <= p.endDate) {
        count++
        result.push({...bill, id: bill.id+'_w'+count, periodKey: bill.id+'_'+p.payDate.toISOString().slice(0,10)+'_w'+count, dueDate: new Date(d)})
        d.setDate(d.getDate()+7)
      }
    } else if (bill.due_each === 'monthly') {
      const months = []
      let d = new Date(p.payDate); d.setDate(1)
      while(d<=p.endDate){months.push(new Date(d));d.setMonth(d.getMonth()+1)}
      for (const ms of months) {
        const dd = bill.due_day ? new Date(ms.getFullYear(),ms.getMonth(),bill.due_day) : new Date(p.payDate)
        if (dd>=p.payDate && dd<=p.endDate) {
          result.push({...bill, periodKey:bill.id+'_'+ms.getFullYear()+'_'+(ms.getMonth()+1), dueDate:dd})
        }
      }
    } else if (bill.due_each === 'once' && bill.due_date) {
      const dd = new Date(bill.due_date+'T00:00:00')
      if (dd>=p.payDate && dd<=p.endDate) {
        result.push({...bill, periodKey:bill.id+'_once', dueDate:dd})
      }
    }
  }
  return result
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const billsJson = formData.get('bills')
    const lastPayDate = formData.get('lastPayDate')

    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const bills = JSON.parse(billsJson || '[]')
    const text = await file.text()
    const transactions = parseCSV(text).filter(t => t.amount < 0)
    const periods = lastPayDate ? getPeriods(lastPayDate) : []

    let matched = 0, unmatched = 0
    const results = []
    const matches = []

    for (const tx of transactions) {
      const desc = tx.description.toLowerCase()
      let matchedBill = null

      for (const bill of bills) {
        if (!bill.keywords || bill.keywords.length === 0) continue
        for (const kw of bill.keywords) {
          if (desc.includes(kw.toLowerCase())) {
            matchedBill = bill
            break
          }
        }
        if (matchedBill) break
      }

      if (matchedBill) {
        matched++

        // Find the correct period for this transaction date
        const periodIdx = findPeriodForDate(tx.date, periods)
        let checkKey = null

        if (periodIdx >= 0) {
          const period = periods[periodIdx]
          const periodBills = getBillsForPeriod([matchedBill], period)
          if (periodBills.length > 0) {
            checkKey = 'p'+periodIdx+'_'+periodBills[0].periodKey
          }
        }

        results.push({
          description: tx.description.substring(0,48),
          date: fmtDate(tx.date),
          amount: fmtMoney(Math.abs(tx.amount)),
          matched: true,
          billName: matchedBill.name,
          periodKey: checkKey,
        })
        if (checkKey) matches.push({ billId: matchedBill.id, billName: matchedBill.name, periodKey: checkKey })
      } else {
        unmatched++
        results.push({
          description: tx.description.substring(0,48),
          date: fmtDate(tx.date),
          amount: fmtMoney(Math.abs(tx.amount)),
          matched: false,
        })
      }
    }

    return NextResponse.json({
      total: transactions.length,
      matched,
      unmatched,
      results,
      matches,
    })

  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}