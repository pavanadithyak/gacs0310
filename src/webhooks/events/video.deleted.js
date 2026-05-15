/**
 * Handle video.deleted event
 */
export async function handle(payload, db, queue) {
  const { bookId: externalBookId, reason } = payload.data;
  
  try {
    // 1. Resolve GACS book_id
    const refResult = await db.query(
      'SELECT book_id FROM book_external_refs WHERE source_system = $1 AND external_book_id = $2',
      ['smart_did', externalBookId]
    );
    if (refResult.rows.length === 0) {
      return { status: 'skipped', reason: 'unknown_book_id' };
    }
    
    const gacsBookId = refResult.rows[0].book_id;
    
    // 2. Check if smart_did_video_state exists and update status
    const tableCheck = await db.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables 
       WHERE table_schema='public' AND table_name='smart_did_video_state')`
    );
    
    if (tableCheck.rows[0].exists) {
      await db.query(
        `UPDATE smart_did_video_state 
         SET status = 'deleted', updated_at = NOW(), error_message = $1 
         WHERE book_id = $2`,
        [reason, gacsBookId]
      );
    }
    
    // 3. Mark recommendation segments inactive
    await db.query(
      `UPDATE book_recommendation_segments 
       SET is_active = false, updated_at = NOW() 
       WHERE book_id = $1 AND source_system = 'smart_did'`,
      [gacsBookId]
    );
    
    return { status: 'ok', bookId: gacsBookId };
  } catch (err) {
    console.error(`[video.deleted] error: ${err.message}`);
    // If it fails, we return error_logged
    return { status: 'error_logged' };
  }
}
