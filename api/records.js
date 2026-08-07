// api/records.js - Vercel Serverless Function (Node.js)
// Allows interacting with Supabase securely if deployed on Vercel with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(200).json({
      status: 'notice',
      message: 'Vercel Serverless API is ready. Connect your Supabase credentials in Vercel Environment Variables (SUPABASE_URL & SUPABASE_ANON_KEY) or configure them directly in the app UI settings.',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (req.method === 'GET') {
      const { data: customers, error: custErr } = await supabase
        .from('customers')
        .select(`
          *,
          vehicles (*)
        `)
        .order('id', { ascending: false });

      if (custErr) throw custErr;
      return res.status(200).json({ success: true, data: customers });
    }

    if (req.method === 'POST') {
      const { customer, vehicles } = req.body;
      if (!customer) {
        return res.status(400).json({ error: 'Customer payload is required.' });
      }

      // Insert customer
      const { data: newCustomer, error: insertCustErr } = await supabase
        .from('customers')
        .insert([customer])
        .select()
        .single();

      if (insertCustErr) throw insertCustErr;

      // Insert vehicles if any
      let insertedVehicles = [];
      if (vehicles && vehicles.length > 0) {
        const vehiclePayloads = vehicles.map(v => ({
          ...v,
          customer_id: newCustomer.id
        }));

        const { data: vData, error: vErr } = await supabase
          .from('vehicles')
          .insert(vehiclePayloads)
          .select();

        if (vErr) throw vErr;
        insertedVehicles = vData;
      }

      return res.status(201).json({
        success: true,
        data: { ...newCustomer, vehicles: insertedVehicles }
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
};
