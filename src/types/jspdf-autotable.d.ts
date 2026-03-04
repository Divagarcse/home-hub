declare module "jspdf-autotable" {
  import { jsPDF } from "jspdf";
  
  interface AutoTableOptions {
    head?: any[][];
    body?: any[][];
    startY?: number;
    styles?: Record<string, any>;
    headStyles?: Record<string, any>;
  }
  
  function autoTable(doc: jsPDF, options: AutoTableOptions): void;
  
  export default autoTable;
}

declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}
