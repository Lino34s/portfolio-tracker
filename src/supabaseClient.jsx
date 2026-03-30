import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Se isto der erro no browser, saberemos que é aqui
console.log("Supabase URL carregado:", !!supabaseUrl)

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
