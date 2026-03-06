CREATE OR REPLACE PROCEDURE TABULARIUM.GOLD.BI_MKT_TREND_SALES_BY_PRODUCT("GROUP_PRINCIPAL_ID" NUMBER(38,0) DEFAULT null, "P_ADJUSTMENT_WEEK" NUMBER(38,0) DEFAULT -1)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS '
/*
  Author               : Dwicky
  Creation Date        : 09-02-2026
  Description          : Get Data Trend Sales By Product
  -------------------------------------------------------------------  
  Param Name         I/O  Type   Length  Example  Description  
  GROUP_PRINCIPAL_ID -    Number -       1,null   Set Group Principal ID
  P_ADJUSTMENT_WEEK  -    Number -       -1,-2    Set how many weeks back you want to, default prev week
  ------------------------------------------------------------------- 
  Example Call Procedure                                     Description
  CALL TABULARIUM.GOLD.BI_MKT_TREND_SALES_BY_PRODUCT(1, -2); Process GP 1, Minus 2 week
  -------------------------------------------------------------------  
  Modification History :  
  ID  Chg-ReqNo  Date    User    Descripton  
  1    -   09-02-2026    DFP     Creation for the first time
  2    -   24-02-2026    DFP     Added Filter Product Group
*/
BEGIN

    IF (GROUP_PRINCIPAL_ID IS NULL OR GROUP_PRINCIPAL_ID IN (1, 3)) THEN
        MERGE INTO TABULARIUM.GOLD.MKT_TREND_SALES_BY_PRODUCT AS tgt
        USING (
            WITH CTE_GET_DATE AS (
                SELECT 
                    MAX(CASE WHEN CURRENT_DATE - (7 - (7 * (:P_ADJUSTMENT_WEEK + 1))) BETWEEN START_DATE AND END_DATE THEN TAHUN END) AS THIS_TAHUN, 
                    MAX(CASE WHEN CURRENT_DATE - (7 - (7 * (:P_ADJUSTMENT_WEEK + 1))) BETWEEN START_DATE AND END_DATE THEN MINGGU END) AS THIS_MINGGU,
                    MAX(CASE WHEN CURRENT_DATE - ((7 * 54) - (7 * (:P_ADJUSTMENT_WEEK + 1))) BETWEEN START_DATE AND END_DATE THEN TAHUN END) AS BEFORE_TAHUN,
                    MAX(CASE WHEN CURRENT_DATE - ((7 * 54) - (7 * (:P_ADJUSTMENT_WEEK + 1))) BETWEEN START_DATE AND END_DATE THEN MINGGU END) AS BEFORE_MINGGU
                FROM TABULARIUM.BRONZE.TBLSAM_PERIODE_MINGGU
            ),
            AGGREGATED_DATA AS (
                SELECT 
                    d.THIS_TAHUN,
                    d.THIS_MINGGU,
                    m.PRODUCT_NAME,
                    m.GROUP_BRAND,
                    
                    -- 1. CTCM
                    COALESCE(SUM(CASE 
                        WHEN m.TAHUN = d.THIS_TAHUN AND m.MINGGU = d.THIS_MINGGU 
                        THEN m.QUANTITY_INVENTORY 
                        ELSE 0 
                    END), 0) / 2000 / 3000 AS THIS_WEEK_RAW,
            
                    -- 2. BCTCM
                    COALESCE(SUM(CASE 
                        WHEN m.TAHUN = d.THIS_TAHUN AND m.MINGGU = d.BEFORE_MINGGU 
                        THEN m.QUANTITY_INVENTORY 
                        ELSE 0 
                    END), 0) / 2000 / 3000 AS LAST_WEEK_RAW,
            
                    -- 3. AVG CTM
                    SUM(IFF(m.TAHUN = d.THIS_TAHUN AND m.MINGGU >= 1 AND m.MINGGU <= d.THIS_MINGGU, COALESCE(m.QUANTITY_INVENTORY, 0), 0))
                        / NULLIF(COUNT(DISTINCT IFF(m.TAHUN = d.THIS_TAHUN AND m.MINGGU >= 1 AND m.MINGGU <= d.THIS_MINGGU, m.MINGGU, NULL)), 0)
                        / 2000 / 3000 AS AVG_CTM_RAW,
            
                    -- 4. AVG PTCM
                    SUM(IFF(m.TAHUN = d.BEFORE_TAHUN AND m.MINGGU >= 1 AND m.MINGGU <= d.THIS_MINGGU, COALESCE(m.QUANTITY_INVENTORY, 0), 0))
                        / NULLIF(COUNT(DISTINCT IFF(m.TAHUN = d.BEFORE_TAHUN AND m.MINGGU >= 1 AND m.MINGGU <= d.THIS_MINGGU, m.MINGGU, NULL)), 0)
                        / 2000 / 3000 AS AVG_PTM_RAW,
            
                    -- 5. Avg Previous Full Year (PFY) - (Assuming TAHUN = THIS_TAHUN - 1)
                    SUM(IFF(m.TAHUN = (d.THIS_TAHUN - 1), COALESCE(m.QUANTITY_INVENTORY, 0), 0))
                        / NULLIF(COUNT(DISTINCT IFF(m.TAHUN = (d.THIS_TAHUN - 1), m.MINGGU, NULL)), 0)
                        / 2000 / 3000 AS AVG_PFY_RAW
            
                FROM TABULARIUM.GOLD.MKT_FAKTUR_SUM_BY_COMPANY m
                CROSS JOIN CTE_GET_DATE d
                WHERE 
                    m.TAHUN IN (d.THIS_TAHUN, d.BEFORE_TAHUN, d.THIS_TAHUN - 1)
                    AND (GROUP_PRINCIPAL_ID IS NULL OR m.GROUP_PRINCIPAL_ID = GROUP_PRINCIPAL_ID)
                    AND (m.PRODUCT_GROUP in (''SKM REGULAR'', ''SKT REGULAR'', ''SPM'', ''SKM LIGHT'') OR m.GROUP_BRAND = ''D. CIGARILLOS'')
                GROUP BY 
                    m.PRODUCT_NAME, 
                    m.GROUP_BRAND, 
                    d.THIS_TAHUN, 
                    d.THIS_MINGGU, 
                    d.BEFORE_TAHUN, 
                    d.BEFORE_MINGGU
            )
            SELECT 
                THIS_TAHUN             AS CUR_TAHUN,
                THIS_MINGGU            AS CUR_MINGGU,
                PRODUCT_NAME,
                GROUP_BRAND,
                -- Formatting and Rounding
                ROUND(THIS_WEEK_RAW, 15)     AS CTCM_QTY_JT_BTG,
                ROUND(LAST_WEEK_RAW, 15)     AS BCTCM_QTY_JT_BTG,
                
                ROUND(THIS_WEEK_RAW - LAST_WEEK_RAW, 15) AS CTCM_VS_BCTCM_CHANGE,
                
                COALESCE(ROUND(((THIS_WEEK_RAW / NULLIF(LAST_WEEK_RAW, 0)) - 1) * 100, 15), 0) AS CTCM_VS_BCTCM_CHANGE_PCT,
                
                CASE 
                    WHEN (THIS_WEEK_RAW - LAST_WEEK_RAW) = 0 THEN ''FLAT''
                    WHEN (THIS_WEEK_RAW - LAST_WEEK_RAW) < 0 THEN ''DECREASE''
                    ELSE ''INCREASE''
                END AS CTCM_VS_BCTCM_DIRECTION,
            
                -- Averages Formatting
                ROUND(COALESCE(AVG_CTM_RAW, 0), 15) AS AVG_CTCM_QTY_JT_BTG,
                ROUND(COALESCE(AVG_PTM_RAW, 0), 15) AS AVG_PTCM_QTY_JT_BTG,
                
                ROUND(COALESCE(AVG_CTM_RAW, 0) - COALESCE(AVG_PTM_RAW, 0), 15) AS AVG_CTCM_VS_AVG_PTCM_CHANGE,
                
                CASE 
                    WHEN COALESCE(AVG_PTM_RAW, 0) = 0 THEN 0.0
                    ELSE ROUND(((COALESCE(AVG_CTM_RAW, 0) / AVG_PTM_RAW) - 1) * 100, 15) 
                END AS AVG_CTCM_VS_AVG_PTM_CHANGE_PCT,
                
                CASE 
                    WHEN COALESCE(AVG_CTM_RAW, 0) - COALESCE(AVG_PTM_RAW, 0) = 0 THEN ''FLAT''
                    WHEN COALESCE(AVG_CTM_RAW, 0) - COALESCE(AVG_PTM_RAW, 0) < 0 THEN ''DECREASE''
                    ELSE ''INCREASE''
                END AS AVG_CTCM_VS_AVG_PTM_DIRECTION,
            
                ROUND(COALESCE(AVG_PFY_RAW, 0), 15) AS AVG_LYFY_QTY_JT_BTG,
                
                ROUND(COALESCE(AVG_CTM_RAW, 0) - COALESCE(AVG_PFY_RAW, 0), 15) AS AVG_CTCM_VS_AVG_LYFY_CHANGE,
                
                CASE 
                    WHEN COALESCE(AVG_PFY_RAW, 0) = 0 THEN 0.0
                    ELSE ROUND(((COALESCE(AVG_CTM_RAW, 0) / AVG_PFY_RAW) - 1) * 100, 15)
                END AS AVG_CTCM_VS_AVG_LYFY_CHANGE_PCT,
                
                CASE 
                    WHEN COALESCE(AVG_CTM_RAW, 0) - COALESCE(AVG_PFY_RAW, 0) = 0 THEN ''FLAT''
                    WHEN COALESCE(AVG_CTM_RAW, 0) - COALESCE(AVG_PFY_RAW, 0) < 0 THEN ''DECREASE''
                    ELSE ''INCREASE''
                END AS AVG_CTCM_VS_AVG_LYFY_DIRECTION
            FROM AGGREGATED_DATA
        ) AS src
        ON  tgt.CUR_TAHUN       = src.CUR_TAHUN
        AND tgt.CUR_MINGGU      = src.CUR_MINGGU
        AND tgt.PRODUCT_NAME    = src.PRODUCT_NAME
        AND tgt.GROUP_BRAND     = src.GROUP_BRAND
        
        WHEN MATCHED THEN UPDATE SET
            tgt.CTCM_QTY_JT_BTG                = src.CTCM_QTY_JT_BTG,
            tgt.BCTCM_QTY_JT_BTG               = src.BCTCM_QTY_JT_BTG,
            tgt.CTCM_VS_BCTCM_CHANGE           = src.CTCM_VS_BCTCM_CHANGE,
            tgt.CTCM_VS_BCTCM_CHANGE_PCT       = src.CTCM_VS_BCTCM_CHANGE_PCT,
            tgt.CTCM_VS_BCTCM_DIRECTION           = src.CTCM_VS_BCTCM_DIRECTION,
            tgt.AVG_CTCM_QTY_JT_BTG           = src.AVG_CTCM_QTY_JT_BTG,
            tgt.AVG_PTCM_QTY_JT_BTG           = src.AVG_PTCM_QTY_JT_BTG,
            tgt.AVG_CTCM_VS_AVG_PTCM_CHANGE   = src.AVG_CTCM_VS_AVG_PTCM_CHANGE,
            tgt.AVG_CTCM_VS_AVG_PTCM_CHANGE_PCT = src.AVG_CTCM_VS_AVG_PTM_CHANGE_PCT,
            tgt.AVG_CTCM_VS_AVG_PTCM_DIRECTION    = src.AVG_CTCM_VS_AVG_PTM_DIRECTION,
            tgt.AVG_LYFY_QTY_JT_BTG           = src.AVG_LYFY_QTY_JT_BTG,
            tgt.AVG_CTCM_VS_AVG_LYFY_CHANGE   = src.AVG_CTCM_VS_AVG_LYFY_CHANGE,
            tgt.AVG_CTCM_VS_AVG_LYFY_CHANGE_PCT = src.AVG_CTCM_VS_AVG_LYFY_CHANGE_PCT,
            tgt.AVG_CTCM_VS_AVG_LYFY_DIRECTION    = src.AVG_CTCM_VS_AVG_LYFY_DIRECTION
        
        WHEN NOT MATCHED THEN INSERT (
            CUR_TAHUN,
            CUR_MINGGU,
            PRODUCT_NAME,
            GROUP_BRAND,
            CTCM_QTY_JT_BTG,
            BCTCM_QTY_JT_BTG,
            CTCM_VS_BCTCM_CHANGE,
            CTCM_VS_BCTCM_CHANGE_PCT,
            CTCM_VS_BCTCM_DIRECTION,
            AVG_CTCM_QTY_JT_BTG,
            AVG_PTCM_QTY_JT_BTG,
            AVG_CTCM_VS_AVG_PTCM_CHANGE,
            AVG_CTCM_VS_AVG_PTCM_CHANGE_PCT,
            AVG_CTCM_VS_AVG_PTCM_DIRECTION,
            AVG_LYFY_QTY_JT_BTG,
            AVG_CTCM_VS_AVG_LYFY_CHANGE,
            AVG_CTCM_VS_AVG_LYFY_CHANGE_PCT,
            AVG_CTCM_VS_AVG_LYFY_DIRECTION
        ) VALUES (
            src.CUR_TAHUN,
            src.CUR_MINGGU,
            src.PRODUCT_NAME,
            src.GROUP_BRAND,
            src.CTCM_QTY_JT_BTG,
            src.BCTCM_QTY_JT_BTG,
            src.CTCM_VS_BCTCM_CHANGE,
            src.CTCM_VS_BCTCM_CHANGE_PCT,
            src.CTCM_VS_BCTCM_DIRECTION,
            src.AVG_CTCM_QTY_JT_BTG,
            src.AVG_PTCM_QTY_JT_BTG,
            src.AVG_CTCM_VS_AVG_PTCM_CHANGE,
            src.AVG_CTCM_VS_AVG_PTM_CHANGE_PCT,
            src.AVG_CTCM_VS_AVG_PTM_DIRECTION,
            src.AVG_LYFY_QTY_JT_BTG,
            src.AVG_CTCM_VS_AVG_LYFY_CHANGE,
            src.AVG_CTCM_VS_AVG_LYFY_CHANGE_PCT,
            src.AVG_CTCM_VS_AVG_LYFY_DIRECTION
        );
    END IF;
    
    RETURN ''Merge Data Trend Sales By Product Success.'';
END;   
';