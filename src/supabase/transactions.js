// src/supabase/transactions.js

import { supabase } from '../supabaseClient'

export async function loadTransactions() {
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    console.warn("Utilizador não autenticado")
    return []
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (error) {
    console.error("Erro ao carregar transações:", error)
    return []
  }

  return data || []
}

export async function saveTransaction(tx) {
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) throw new Error("Utilizador não autenticado")

  const { data, error } = await supabase
    .from('transactions')
    .upsert({ ...tx, user_id: user.id }, { onConflict: 'id' })
    .select()

  if (error) throw error
  return data?.[0]
}

export async function deleteTransaction(id) {
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) throw new Error("Utilizador não autenticado")

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) throw error
}
