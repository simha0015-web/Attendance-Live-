'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/hooks/use-app';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, startOfYear, endOfYear, isSameDay, getDay, isSunday, isSaturday, subMonths, setDate } from 'date-fns';
import { Users, CheckCircle2, Clock, Award, BarChart3, CalendarRange } from 'lucide-react';
import type { ShiftSettings } from '@/lib/types';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function MonthlyReport() {
  const { employees, attendanceRecords, extraStatuses, markExtraStatus, shiftSettings } = useApp();
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  
  // కస్టమ్ పరిధి సెలెక్టర్లు
  const [startCutoffDay, setStartCutoffDay] = useState<string>('1');
  const [endCutoffDay, setEndCutoffDay] = useState<string>('end');

  const [editingDay, setEditingDay] = useState<{ empId: string, date: string, autoLate: number } | null>(null);
  
  const [editForm, setEditForm] = useState<{ 
    status: string, 
    inTime: string, 
    outTime: string, 
    ot: string, 
    lateIn: string, 
    earlyOut: string, 
    extraShiftBenefit: 'None' | 'C-off Earned' | 'C-off Used' | 'OT',
    coffQty: string
  }>({ 
    status: 'None', 
    inTime: '09:00', 
    outTime: '18:00', 
    ot: '0', 
    lateIn: '', 
    earlyOut: '0', 
    extraShiftBenefit: 'None', 
    coffQty: '1' 
  });

  const selectedYear = selectedMonth.getFullYear();

  // సైకిల్ పరిధి రోజుల లెక్కింపు
  const daysInCycle = useMemo(() => {
    if (startCutoffDay === '1' && endCutoffDay === 'end') {
      return eachDayOfInterval({
        start: startOfMonth(selectedMonth),
        end: endOfMonth(selectedMonth),
      });
    }

    const prevMonth = subMonths(selectedMonth, 1);
    const sDayNum = parseInt(startCutoffDay);
    const startDate = setDate(prevMonth, Math.min(sDayNum, endOfMonth(prevMonth).getDate()));

    let endDate: Date;
    if (endCutoffDay === 'end') {
      endDate = endOfMonth(selectedMonth);
    } else {
      const eDayNum = parseInt(endCutoffDay);
      endDate = setDate(selectedMonth, Math.min(eDayNum, endOfMonth(selectedMonth).getDate()));
    }

    if (startDate > endDate) {
      return eachDayOfInterval({
        start: startOfMonth(selectedMonth),
        end: endOfMonth(selectedMonth),
      });
    }

    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [selectedMonth, startCutoffDay, endCutoffDay]);

  // 1. నెలవారీ లెక్కింపు (P, CE, OT కచ్చితంగా వేర్వేరుగా లెక్కింపు)
  const reportData = useMemo(() => {
    return employees.filter(e => {
        if (e.status === 'Approved') return true;
        if (e.status === 'Resigned') {
            const hasActivity = attendanceRecords.some(r => 
                r.employeeId.toUpperCase() === e.id.toUpperCase() && 
                daysInCycle.some(d => isSameDay(new Date(r.dateTime), d))
            ) || extraStatuses.some(ex => 
                ex.employeeId.toUpperCase() === e.id.toUpperCase() &&
                daysInCycle.some(d => format(d, 'yyyy-MM-dd') === ex.date)
            );
            return hasActivity;
        }
        return false;
    }).map(employee => {
      let monthlyCustomLateHoursCut = 0;
      let monthlyCoffsEarned = 0;
      let monthlyCoffsUsed = 0;

      let countP = 0; // కేవలం రెగ్యులర్ Present మాత్రమే
      let countA = 0;
      let countW = 0;
      let countH = 0;
      let countL = 0;
      let countHD = 0;
      let totalOTHours = 0; // కేవలం OT మాత్రమే

      const dailyStatus = daysInCycle.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayRecords = attendanceRecords.filter(r => 
          r.employeeId.toUpperCase() === employee.id.toUpperCase() && 
          isSameDay(new Date(r.dateTime), day)
        );
        const extra = extraStatuses.find(ex => ex.employeeId.toUpperCase() === employee.id.toUpperCase() && ex.date === dateStr);

        const primaryRecord = dayRecords.length > 0 ? dayRecords[dayRecords.length - 1] : null; 
        const shiftType = primaryRecord?.shift || 'General';
        const shiftStartHour = shiftSettings[shiftType as keyof ShiftSettings]?.startHour ?? 9;
        const actualTime = primaryRecord ? new Date(primaryRecord.dateTime) : null;
        let autoLateIn = 0;
        if (actualTime) {
          const actualHours = actualTime.getHours() + actualTime.getMinutes() / 60;
          autoLateIn = Math.max(0, actualHours - shiftStartHour);
        }

        let status: 'Present' | 'Absent' | 'Week-off' | 'Leave' | 'Holiday' | 'C-off' | 'Half-Day' | 'OT' = 'Absent';
        
        if (extra && extra.status && extra.status !== 'None') {
          status = extra.status as any;
        } else if (dayRecords.length > 0) {
          status = 'Present';
        } else if (employee.weekOffDay === DAYS_OF_WEEK[getDay(day)]) {
          status = 'Week-off';
        }

        const effectiveLateIn = (extra && extra.lateInHours !== undefined && extra.lateInHours !== 0) 
          ? extra.lateInHours 
          : (extra?.status === 'Absent' || extra?.status === 'Leave' ? 0 : autoLateIn);
          
        const dailyLate = effectiveLateIn + (extra?.earlyOutHours || 0);
        monthlyCustomLateHoursCut += dailyLate;

        let autoExtraHours = 0;
        if (dayRecords.length > 1) {
            dayRecords.slice(0, dayRecords.length - 1).forEach(r => {
                autoExtraHours += shiftSettings[r.shift as keyof ShiftSettings]?.dutyHours || 8;
            });
        }

        const rawBenefit = (extra?.extraShiftBenefit || 'None') as string;
        let finalOT = 0;
        let dayCoffEarned = 0;
        let dayCoffUsed = 0;

        let rawExtraHours = extra?.otHours ?? autoExtraHours;
        if (status === 'OT' && rawExtraHours === 0) {
          rawExtraHours = 8;
        }

        let displayBadge = 'A';
        
        // ----------------------------------------------------
        // ఖచ్చితమైన ప్రత్యేక కౌంటింగ్ (NO OVERLAPPING / NO DOUBLING)
        // ----------------------------------------------------

        // 1. C-off Earned (కేవలం CE లోనే కౌంట్ అవుతుంది - P లో కలవదు)
        if (rawBenefit === 'C-off Earned') {
          displayBadge = 'CE';
          dayCoffEarned = rawExtraHours > 0 ? Number((rawExtraHours / 8).toFixed(2)) : 1;
          monthlyCoffsEarned += dayCoffEarned;
        } 
        // 2. C-off Used (కేవలం CU లోనే కౌంట్ అవుతుంది)
        else if (rawBenefit === 'C-off Used' || status === 'C-off') {
          displayBadge = 'CU';
          dayCoffUsed = rawExtraHours > 0 ? Number((rawExtraHours / 8).toFixed(2)) : 1;
          monthlyCoffsUsed += dayCoffUsed;
        } 
        // 3. Overtime Duty (కేవలం OT లోనే కౌంట్ అవుతుంది - P లో కలవదు)
        else if (status === 'OT' || rawBenefit === 'OT') {
          displayBadge = 'OT';
          finalOT = rawExtraHours > 0 ? rawExtraHours : 8;
          totalOTHours += finalOT;
        } 
        // 4. Regular Present (కేవలం సాధారణ రోజు వచ్చినప్పుడు మాత్రమే P పెరుగుతుంది)
        else if (status === 'Present') {
          displayBadge = 'P';
          countP++;
          // అదనపు OT గంటలు ఉంటే వాటిని OT లో కలుపుతుంది
          if (extra?.otHours && extra.otHours > 0) {
            finalOT = extra.otHours;
            totalOTHours += finalOT;
          }
        } 
        else if (status === 'Week-off') {
          displayBadge = 'W';
          countW++;
        } 
        else if (status === 'Holiday') {
          displayBadge = 'H';
          countH++;
        } 
        else if (status === 'Leave') {
          displayBadge = 'L';
          countL++;
        } 
        else if (status === 'Half-Day') {
          displayBadge = 'HD';
          countHD++;
        } 
        else {
          displayBadge = 'A';
          countA++;
        }

        return { 
          day, 
          dateStr, 
          status, 
          displayBadge, 
          ot: finalOT, 
          dayCoffEarned, 
          dayCoffUsed, 
          extraShiftBenefit: rawBenefit, 
          late: dailyLate, 
          lateIn: effectiveLateIn, 
          earlyOut: extra?.earlyOutHours || 0, 
          autoLateIn, 
          punches: dayRecords.length 
        };
      });

      // ----------------------------------------------------
      // PAID DAYS లో మాత్రమే P, W, H, OT కలిసి వస్తాయి
      // ----------------------------------------------------
      const otDaysEquivalent = totalOTHours > 0 ? Number((totalOTHours / 8).toFixed(2)) : 0;
      const totalEffectivePaidDays = Number((countP + countW + countH + otDaysEquivalent + (countHD * 0.5)).toFixed(2));
      
      const basePay = (employee as any).basicSalary || ((employee.dailyRate || 500) * 30);
      const effectiveDailyRate = basePay / 30; // Daily Rate ఫార్ములా[cite: 1]
      const hourlyRate = effectiveDailyRate / 8; // Hourly Rate ఫార్ములా[cite: 1]
      
      // Paid Days ఆధారంగా Net Salary లెక్కింపు
      const earnedBasicAmount = Math.round(totalEffectivePaidDays * effectiveDailyRate);
      const grossEarned = earnedBasicAmount + (employee.incentive || 0) + (employee.foodAllowance || 0) + (employee.otherEarnings || 0);

      const lateHoursDeduction = Math.round(monthlyCustomLateHoursCut * hourlyRate);
      const finalNetSalary = Math.max(0, grossEarned - (employee.loanRecovery || 0) - lateHoursDeduction);

      return { 
        ...employee, 
        dailyStatus, 
        stats: {
          Present: countP, // కేవలం స్వచ్ఛమైన P మాత్రమే
          Absent: countA,
          'Week-off': countW,
          Holiday: countH,
          Leave: countL,
          'Half-Day': countHD,
          totalOT: totalOTHours, // కేవలం OT మాత్రమే
          otDays: otDaysEquivalent
        },
        salary: finalNetSalary, // Paid Days ఆధారంగా వచ్చిన నెట్ శాలరీ
        paidWorkingDays: totalEffectivePaidDays, 
        totalDays: daysInCycle.length, 
        totalLateHoursCut: monthlyCustomLateHoursCut, 
        totalCoffsEarned: Number(monthlyCoffsEarned.toFixed(2)), // స్వచ్ఛమైన CE
        totalCoffsUsed: Number(monthlyCoffsUsed.toFixed(2)),     // స్వచ్ఛమైన CU
        coffBalance: Number((monthlyCoffsEarned - monthlyCoffsUsed).toFixed(2))
      };
    });
  }, [employees, attendanceRecords, extraStatuses, daysInCycle, shiftSettings]);

  // 2. వార్షిక లెక్కింపు (Yearly View - Strict Separation for P, CE, OT)
  const yearlyReportData = useMemo(() => {
    const daysInYear = eachDayOfInterval({
      start: startOfYear(new Date(selectedYear, 0, 1)),
      end: endOfYear(new Date(selectedYear, 0, 1)),
    });

    return employees.filter(e => e.status === 'Approved' || e.status === 'Resigned').map(employee => {
      let pCount = 0;
      let totalOtHours = 0;
      let aCount = 0;
      let wCount = 0;
      let hCount = 0;
      let hdCount = 0;
      let totalCoffsEarned = 0;
      let totalCoffsUsed = 0;

      daysInYear.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayRecords = attendanceRecords.filter(r => 
          r.employeeId.toUpperCase() === employee.id.toUpperCase() && 
          isSameDay(new Date(r.dateTime), day)
        );
        const extra = extraStatuses.find(ex => ex.employeeId.toUpperCase() === employee.id.toUpperCase() && ex.date === dateStr);

        let status: string = 'Absent';
        if (extra && extra.status && extra.status !== 'None') {
          status = extra.status;
        } else if (dayRecords.length > 0) {
          status = 'Present';
        } else if (employee.weekOffDay === DAYS_OF_WEEK[getDay(day)]) {
          status = 'Week-off';
        }

        let autoExtra = 0;
        if (dayRecords.length > 1) {
          dayRecords.slice(0, dayRecords.length - 1).forEach(r => {
            autoExtra += shiftSettings[r.shift as keyof ShiftSettings]?.dutyHours || 8;
          });
        }
        let rawExtra = extra?.otHours ?? autoExtra;
        if (status === 'OT' && rawExtra === 0) rawExtra = 8;

        const rawBenefit = (extra?.extraShiftBenefit || 'None') as string;
        
        // వార్షికంలో కూడా ఖచ్చితమైన ప్రత్యేక కౌంటింగ్
        if (rawBenefit === 'C-off Earned') {
          totalCoffsEarned += (rawExtra > 0 ? Number((rawExtra / 8).toFixed(2)) : 1);
        } else if (rawBenefit === 'C-off Used' || status === 'C-off') {
          totalCoffsUsed += (rawExtra > 0 ? Number((rawExtra / 8).toFixed(2)) : 1);
        } else if (status === 'OT' || rawBenefit === 'OT') {
          totalOtHours += rawExtra;
        } else if (status === 'Present') {
          pCount++; // కేవలం వాస్తవ P మాత్రమే
          if (extra?.otHours && extra.otHours > 0) {
            totalOtHours += extra.otHours;
          }
        } else if (status === 'Absent') {
          aCount++;
        } else if (status === 'Week-off') {
          wCount++;
        } else if (status === 'Holiday') {
          hCount++;
        } else if (status === 'Half-Day') {
          hdCount++;
        }
      });

      const coffPending = Math.max(0, totalCoffsEarned - totalCoffsUsed);
      const otDays = Number((totalOtHours / 8).toFixed(2));
      // Paid Days లో మాత్రమే అన్ని కలపబడతాయి
      const yearlyPaidDays = Number((pCount + wCount + hCount + otDays + (hdCount * 0.5)).toFixed(2));

      return {
        id: employee.id,
        name: employee.name,
        p: pCount, // Strictly P only
        otHours: totalOtHours, // Strictly OT only
        otDays,
        yearlyPaidDays, // P + W + H + OT
        a: aCount,
        w: wCount,
        h: hCount,
        hd: hdCount,
        coffEarned: Number(totalCoffsEarned.toFixed(2)), // Strictly CE only
        coffUsed: Number(totalCoffsUsed.toFixed(2)),     // Strictly CU only
        coffPending: Number(coffPending.toFixed(2))
      };
    });
  }, [employees, attendanceRecords, extraStatuses, selectedYear, shiftSettings]);

  const yearlyGrandTotals = useMemo(() => {
    return yearlyReportData.reduce((acc, curr) => {
      acc.p += curr.p;
      acc.otHours += curr.otHours;
      acc.otDays += curr.otDays;
      acc.yearlyPaidDays += curr.yearlyPaidDays;
      acc.a += curr.a;
      acc.w += curr.w;
      acc.h += curr.h;
      acc.coffEarned += curr.coffEarned;
      acc.coffUsed += curr.coffUsed;
      acc.coffPending += curr.coffPending;
      return acc;
    }, { p: 0, otHours: 0, otDays: 0, yearlyPaidDays: 0, a: 0, w: 0, h: 0, coffEarned: 0, coffUsed: 0, coffPending: 0 });
  }, [yearlyReportData]);

  const grandTotals = useMemo(() => {
    return reportData.reduce((acc, curr) => {
      acc.totalDays += curr.totalDays;
      acc.present += curr.stats.Present;
      acc.absent += curr.stats.Absent;
      acc.holiday += curr.stats.Holiday;
      acc.halfday += curr.stats['Half-Day'];
      acc.weekoff += curr.stats['Week-off'];
      acc.ot += curr.stats.totalOT;
      acc.coffsEarned += curr.totalCoffsEarned;
      acc.coffsUsed += curr.totalCoffsUsed;
      acc.paidWorkingDays += curr.paidWorkingDays;
      acc.salary += curr.salary;
      return acc;
    }, { totalDays: 0, present: 0, absent: 0, holiday: 0, halfday: 0, weekoff: 0, ot: 0, coffsEarned: 0, coffsUsed: 0, paidWorkingDays: 0, salary: 0 });
  }, [reportData]);

  const handleDayClick = (empId: string, dateStr: string) => {
    const current = extraStatuses.find(e => e.employeeId.toUpperCase() === empId.toUpperCase() && e.date === dateStr);
    const empData = reportData.find(d => d.id === empId);
    const dayData = empData?.dailyStatus.find(s => s.dateStr === dateStr);
    const autoLate = dayData?.autoLateIn || 0;

    let initialStatus = current?.status || 'None';
    let initialBenefit = (current?.extraShiftBenefit as any) || 'None';

    setEditForm({ 
      status: initialStatus, 
      inTime: '09:00', 
      outTime: (current?.otHours && current.otHours > 0) ? `${18 + Math.floor(current.otHours)}:00` : '18:00', 
      ot: (current?.otHours || 0).toString(), 
      lateIn: current?.lateInHours !== undefined ? current.lateInHours.toString() : '', 
      earlyOut: (current?.earlyOutHours || 0).toString(), 
      extraShiftBenefit: initialBenefit, 
      coffQty: '1' 
    });
    setEditingDay({ empId, date: dateStr, autoLate });
  };

  const handleTimingChange = (inT: string, outT: string) => {
    setEditForm(prev => {
      const [inH, inM] = inT.split(':').map(Number);
      const [outH, outM] = outT.split(':').map(Number);
      
      const inHours = inH + (inM / 60);
      let outHours = outH + (outM / 60);
      if (outHours < inHours) outHours += 24;

      const totalDuty = Math.max(0, outHours - inHours);
      const autoOT = totalDuty > 8 ? Number((totalDuty - 8).toFixed(1)) : 0;
      const autoLate = inHours > 9.25 ? Number((inHours - 9).toFixed(1)) : 0;

      return {
        ...prev,
        inTime: inT,
        outTime: outT,
        ot: autoOT.toString(),
        lateIn: autoLate > 0 ? autoLate.toString() : prev.lateIn
      };
    });
  };

  const saveDayStatus = () => {
    if (!editingDay) return;
    const { empId, date } = editingDay;
    
    let hoursToSave = parseFloat(editForm.ot) || 0;
    let finalStatus = editForm.status;
    let benefitToSave: any = editForm.extraShiftBenefit;

    if (benefitToSave === 'C-off Used') {
      finalStatus = 'C-off';
      if (hoursToSave === 0) hoursToSave = parseFloat(editForm.coffQty) * 8;
    } 
    else if (benefitToSave === 'C-off Earned') {
      if (finalStatus === 'None' || finalStatus === 'C-off' || finalStatus === 'Absent') finalStatus = 'Present';
      if (hoursToSave === 0) hoursToSave = parseFloat(editForm.coffQty) * 8;
    } 

    markExtraStatus(
      empId, 
      date, 
      finalStatus as any, 
      hoursToSave, 
      editForm.lateIn === '' ? 0 : parseFloat(editForm.lateIn), 
      parseFloat(editForm.earlyOut) || 0, 
      benefitToSave
    );
    setEditingDay(null);
  };

  const currentYear = selectedMonth.getFullYear();
  const currentMonth = selectedMonth.getMonth();

  return (
    <div className="space-y-6">
      {/* సమ్మరీ కార్డ్స్ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="bg-primary/5">
          <CardContent className="p-3 sm:pt-6 flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-4 text-center sm:text-left">
            <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            <div>
              <p className="text-[10px] sm:text-sm font-medium text-muted-foreground uppercase tracking-wider">Staff</p>
              <h3 className="text-lg sm:text-2xl font-bold">{reportData.length}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-50">
          <CardContent className="p-3 sm:pt-6 flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-4 text-center sm:text-left">
            <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
            <div>
              <p className="text-[10px] sm:text-sm font-medium uppercase tracking-wider">Present (Today)</p>
              <h3 className="text-lg sm:text-2xl font-bold">{attendanceRecords.filter(r => isSameDay(new Date(r.dateTime), new Date())).length}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50">
          <CardContent className="p-3 sm:pt-6 flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-4 text-center sm:text-left">
            <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600" />
            <div>
              <p className="text-[10px] sm:text-sm font-medium uppercase tracking-wider">{viewMode === 'year' ? `${selectedYear} OT` : 'Cycle OT'}</p>
              <h3 className="text-lg sm:text-2xl font-bold">{viewMode === 'year' ? `${yearlyGrandTotals.otHours}h` : `${grandTotals.ot}h`}</h3>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="p-3 sm:pt-6 flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-4 text-center sm:text-left">
            <Award className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" />
            <div>
              <p className="text-[10px] sm:text-sm font-medium uppercase tracking-wider">{viewMode === 'year' ? `${selectedYear} C-off Bal` : 'C-offs (CU / CE)'}</p>
              <h3 className="text-lg sm:text-2xl font-bold">
                {viewMode === 'year' 
                  ? `${yearlyGrandTotals.coffPending.toFixed(1)} Bal` 
                  : `${grandTotals.coffsUsed.toFixed(1)} CU / ${grandTotals.coffsEarned.toFixed(1)} CE`}
              </h3>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-border/80 shadow-md">
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between space-y-4 md:space-y-0 px-4 sm:px-6">
          <div className="w-full">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl sm:text-2xl font-bold">
                {viewMode === 'month' ? 'Master Attendance Report' : `${selectedYear} Full Year Attendance & C-off Ledger`}
              </CardTitle>
            </div>
            <CardDescription className="text-xs sm:text-sm mt-1">
              {viewMode === 'month' 
                ? `P (Present), CE (C-off Earned), OT వేర్వేరుగా లెక్కింపబడ్డాయి. Paid Days = P + W + H + OT Days.` 
                : `${selectedYear} సంవత్సరానికి సంబంధించిన విడివిడి P, CE, OT మరియు Paid Days లెక్కలు.`}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {viewMode === 'month' && (
              <div className="flex items-center gap-1.5 bg-blue-50/80 p-1 rounded-xl border border-blue-200">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-blue-900 uppercase pl-1">From:</span>
                  <Select value={startCutoffDay} onValueChange={(v) => setStartCutoffDay(v)}>
                    <SelectTrigger className="w-[85px] h-8 text-xs font-bold bg-white border-blue-300">
                      <SelectValue placeholder="Prev Date" />
                    </SelectTrigger>
                    <SelectContent className="max-h-56 overflow-y-auto">
                      {Array.from({ length: 31 }).map((_, i) => {
                        const d = i + 1;
                        return <SelectItem key={d} value={d.toString()}>{d} (Prev)</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-blue-900 uppercase">To:</span>
                  <Select value={endCutoffDay} onValueChange={(v) => setEndCutoffDay(v)}>
                    <SelectTrigger className="w-[85px] h-8 text-xs font-bold bg-white border-blue-300">
                      <SelectValue placeholder="Curr Date" />
                    </SelectTrigger>
                    <SelectContent className="max-h-56 overflow-y-auto">
                      <SelectItem value="end">Month End</SelectItem>
                      {Array.from({ length: 31 }).map((_, i) => {
                        const d = i + 1;
                        return <SelectItem key={d} value={d.toString()}>{d} (Curr)</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <Select value={currentYear.toString()} onValueChange={(v) => {
              const d = new Date(selectedMonth);
              d.setFullYear(parseInt(v));
              setSelectedMonth(d);
            }}>
              <SelectTrigger className="w-[95px] h-10 font-bold bg-slate-50 border-slate-300">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                {Array.from({ length: 52 }).map((_, i) => {
                  const year = 2024 + i;
                  return <SelectItem key={year} value={year.toString()}>{year}</SelectItem>;
                })}
              </SelectContent>
            </Select>

            {viewMode === 'month' && (
              <Select value={currentMonth.toString()} onValueChange={(v) => {
                const d = new Date(selectedMonth);
                d.setMonth(parseInt(v));
                setSelectedMonth(d);
              }}>
                <SelectTrigger className="w-[125px] h-10 font-bold bg-slate-50 border-slate-300">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <SelectItem key={i} value={i.toString()}>{format(new Date(2000, i, 1), 'MMMM')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant={viewMode === 'year' ? "default" : "outline"}
              className={`h-10 px-3.5 rounded-xl font-bold flex items-center gap-1.5 transition-all ${
                viewMode === 'year' 
                  ? 'bg-primary text-white shadow-md' 
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
              }`}
              onClick={() => setViewMode(prev => prev === 'month' ? 'year' : 'month')}
            >
              <BarChart3 className="w-4 h-4 text-amber-600" />
              <span>{viewMode === 'year' ? 'Back to Monthly' : `${selectedYear} Full Year`}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0 sm:p-4">
          {viewMode === 'year' ? (
            /* ===================== VIEW 1: YEARLY SUMMARY TABLE ===================== */
            <div className="space-y-4">
              <div 
                style={{
                  width: '100%',
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px'
                }}
              >
                <table 
                  style={{
                    width: '100%',
                    minWidth: '1100px',
                    borderCollapse: 'collapse',
                    textAlign: 'center',
                    backgroundColor: '#ffffff'
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', height: '48px', borderBottom: '2px solid #cbd5e1' }}>
                      <th style={{ width: '220px', padding: '10px 14px', textAlign: 'left', fontWeight: 'bold', fontSize: '13px', borderRight: '2px solid #cbd5e1' }}>Employee Name</th>
                      <th title="Total Present Only" style={{ width: '90px', fontWeight: 'bold', color: '#15803d', backgroundColor: '#dcfce7', borderRight: '1px solid #cbd5e1' }}>P (Present)</th>
                      <th title="Total C-offs Earned" style={{ width: '90px', fontWeight: 'bold', color: '#0f766e', backgroundColor: '#ccfbf1', borderRight: '1px solid #cbd5e1' }}>CE (Earned)</th>
                      <th title="Total OT Hours" style={{ width: '90px', fontWeight: 'bold', color: '#c2410c', backgroundColor: '#ffedd5', borderRight: '1px solid #cbd5e1' }}>OT (Hours)</th>
                      <th title="Total Paid Days (P+W+H+OT)" style={{ width: '100px', fontWeight: '900', color: '#1d4ed8', backgroundColor: '#eff6ff', borderRight: '1px solid #cbd5e1' }}>Paid Days</th>
                      <th title="Total Absent" style={{ width: '80px', fontWeight: 'bold', color: '#b91c1c', backgroundColor: '#fee2e2', borderRight: '1px solid #cbd5e1' }}>A (Absent)</th>
                      <th title="Total Week-off" style={{ width: '85px', fontWeight: 'bold', color: '#b45309', backgroundColor: '#fef3c7', borderRight: '1px solid #cbd5e1' }}>W (Week-off)</th>
                      <th title="Total Holiday" style={{ width: '85px', fontWeight: 'bold', color: '#7e22ce', backgroundColor: '#f3e8ff', borderRight: '1px solid #cbd5e1' }}>H (Holiday)</th>
                      <th title="Total C-offs Used" style={{ width: '90px', fontWeight: 'bold', color: '#6b21a8', backgroundColor: '#fae8ff', borderRight: '1px solid #cbd5e1' }}>CU (Used)</th>
                      <th style={{ width: '100px', fontWeight: '900', color: '#b45309', backgroundColor: '#fef3c7' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyReportData.map(emp => (
                      <tr key={emp.id} style={{ borderBottom: '1px solid #e2e8f0', height: '48px' }}>
                        <td style={{ width: '220px', padding: '8px 14px', textAlign: 'left', borderRight: '2px solid #cbd5e1', fontWeight: 'bold' }}>
                          <div style={{ fontSize: '13px', color: '#0f172a' }}>{emp.name}</div>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>{emp.id}</div>
                        </td>
                        {/* సపరేట్ P కౌంట్ */}
                        <td style={{ fontWeight: 'bold', color: '#15803d', borderRight: '1px solid #cbd5e1' }}>{emp.p}</td>
                        {/* సపరేట్ CE కౌంట్ */}
                        <td style={{ fontWeight: 'bold', color: '#0f766e', borderRight: '1px solid #cbd5e1' }}>{emp.coffEarned.toFixed(1)}</td>
                        {/* సపరేట్ OT కౌంట్ */}
                        <td style={{ fontWeight: 'bold', color: '#c2410c', borderRight: '1px solid #cbd5e1' }}>{emp.otHours}h</td>
                        {/* Paid Days లో మాత్రమే ఇవన్నీ కలవడం */}
                        <td style={{ fontWeight: '900', color: '#1d4ed8', backgroundColor: '#f8fafc', borderRight: '1px solid #cbd5e1' }}>{emp.yearlyPaidDays}</td>
                        <td style={{ fontWeight: 'bold', color: '#dc2626', borderRight: '1px solid #cbd5e1' }}>{emp.a}</td>
                        <td style={{ fontWeight: 'bold', color: '#b45309', borderRight: '1px solid #cbd5e1' }}>{emp.w}</td>
                        <td style={{ fontWeight: 'bold', color: '#7e22ce', borderRight: '1px solid #cbd5e1' }}>{emp.h}</td>
                        <td style={{ fontWeight: 'bold', color: '#7e22ce', borderRight: '1px solid #cbd5e1' }}>{emp.coffUsed.toFixed(1)}</td>
                        <td style={{ fontWeight: '900', color: emp.coffPending > 0 ? '#b45309' : '#64748b', backgroundColor: emp.coffPending > 0 ? '#fffbeb' : '#fff' }}>
                          <span className={`px-2.5 py-1 rounded-md text-xs font-black ${emp.coffPending > 0 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'text-slate-400'}`}>
                            {emp.coffPending.toFixed(1)} Bal
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#f8fafc', height: '48px', fontWeight: '900', borderTop: '2px solid #cbd5e1' }}>
                      <td style={{ padding: '8px 14px', textAlign: 'left', borderRight: '2px solid #cbd5e1' }}>Grand Total ({selectedYear})</td>
                      <td style={{ color: '#15803d', borderRight: '1px solid #cbd5e1', backgroundColor: '#dcfce7' }}>{yearlyGrandTotals.p}</td>
                      <td style={{ color: '#0f766e', borderRight: '1px solid #cbd5e1', backgroundColor: '#ccfbf1' }}>{yearlyGrandTotals.coffEarned.toFixed(1)}</td>
                      <td style={{ color: '#c2410c', borderRight: '1px solid #cbd5e1', backgroundColor: '#ffedd5' }}>{yearlyGrandTotals.otHours}h</td>
                      <td style={{ color: '#1d4ed8', borderRight: '1px solid #cbd5e1', backgroundColor: '#eff6ff' }}>{yearlyGrandTotals.yearlyPaidDays.toFixed(1)}</td>
                      <td style={{ color: '#b91c1c', borderRight: '1px solid #cbd5e1', backgroundColor: '#fee2e2' }}>{yearlyGrandTotals.a}</td>
                      <td style={{ color: '#b45309', borderRight: '1px solid #cbd5e1', backgroundColor: '#fef3c7' }}>{yearlyGrandTotals.w}</td>
                      <td style={{ color: '#7e22ce', borderRight: '1px solid #cbd5e1', backgroundColor: '#f3e8ff' }}>{yearlyGrandTotals.h}</td>
                      <td style={{ color: '#7e22ce', borderRight: '1px solid #cbd5e1', backgroundColor: '#fae8ff' }}>{yearlyGrandTotals.coffUsed.toFixed(1)}</td>
                      <td style={{ color: '#b45309', backgroundColor: '#fef3c7' }}>{yearlyGrandTotals.coffPending.toFixed(1)} Pending</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            /* ===================== VIEW 2: MONTHLY CYCLE TABLE ===================== */
            <div 
              style={{
                width: '100%',
                maxWidth: '100%',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                border: '1px solid #e2e8f0',
                borderRadius: '8px'
              }}
            >
              <table 
                style={{
                  width: '2450px',
                  minWidth: '2450px',
                  borderCollapse: 'collapse',
                  textAlign: 'center',
                  backgroundColor: '#ffffff'
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', height: '50px', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ width: '180px', padding: '10px', textAlign: 'left', fontWeight: 'bold', fontSize: '13px', borderRight: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>
                      Employee Name
                    </th>
                    
                    {daysInCycle.map(day => {
                      const isSun = isSunday(day);
                      const isSat = isSaturday(day);
                      return (
                        <th 
                          key={day.toISOString()} 
                          style={{
                            width: '46px',
                            minWidth: '46px',
                            padding: '4px',
                            borderRight: '1px solid #e2e8f0',
                            backgroundColor: isSun ? '#fee2e2' : isSat ? '#fef3c7' : '#f8fafc',
                            color: isSun ? '#b91c1c' : isSat ? '#b45309' : '#334155',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <div style={{ fontSize: '12px', fontWeight: 'bold' }}>{format(day, 'd')}</div>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', opacity: 0.8 }}>{format(day, 'EEE')}</div>
                        </th>
                      );
                    })}

                    <th title="Present Only (కేవలం హాజరు)" style={{ width: '55px', fontWeight: 'bold', color: '#15803d', backgroundColor: '#dcfce7', borderRight: '1px solid #cbd5e1' }}>P</th>
                    <th title="C-off Earned (క్రెడిట్ మాత్రమే)" style={{ width: '65px', fontWeight: 'bold', color: '#0f766e', backgroundColor: '#ccfbf1', borderRight: '1px solid #cbd5e1' }}>CE</th>
                    <th title="OT Hours (ఓవర్‌టైమ్ మాత్రమే)" style={{ width: '55px', fontWeight: 'bold', color: '#c2410c', backgroundColor: '#ffedd5', borderRight: '1px solid #cbd5e1' }}>OT</th>
                    
                    <th title="Absent" style={{ width: '45px', fontWeight: 'bold', color: '#b91c1c', backgroundColor: '#fee2e2', borderRight: '1px solid #cbd5e1' }}>A</th>
                    <th title="Week-off" style={{ width: '45px', fontWeight: 'bold', color: '#b45309', backgroundColor: '#fef3c7', borderRight: '1px solid #cbd5e1' }}>W</th>
                    <th title="Holiday" style={{ width: '45px', fontWeight: 'bold', color: '#7e22ce', backgroundColor: '#f3e8ff', borderRight: '1px solid #cbd5e1' }}>H</th>
                    <th title="C-off Used" style={{ width: '65px', fontWeight: 'bold', color: '#6b21a8', backgroundColor: '#fae8ff', borderRight: '1px solid #cbd5e1' }}>CU</th>
                    <th title="Late Hours" style={{ width: '50px', fontWeight: 'bold', color: '#dc2626', backgroundColor: '#f1f5f9', borderRight: '1px solid #cbd5e1' }}>Late</th>
                    
                    {/* Paid Days = P + W + H + OT Days */}
                    <th title="Total Paid Days (P + W + H + OT)" style={{ width: '60px', fontWeight: '900', color: '#1d4ed8', backgroundColor: '#eff6ff', borderRight: '1px solid #cbd5e1' }}>Paid</th>
                    <th title="Net Salary (Paid Days ఆధారంగా)" style={{ width: '120px', fontWeight: 'bold', color: '#1e3a8a', backgroundColor: '#dbeafe', whiteSpace: 'nowrap' }}>Net Sal</th>
                  </tr>
                </thead>

                <tbody>
                  {reportData.map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #e2e8f0', height: '48px' }}>
                      <td style={{ width: '180px', padding: '8px 12px', textAlign: 'left', borderRight: '2px solid #cbd5e1', backgroundColor: '#ffffff', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#0f172a' }}>
                          {row.name}
                        </div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>{row.id}</div>
                      </td>

                      {row.dailyStatus.map((s, i) => {
                        const isSun = isSunday(s.day);
                        const isSat = isSaturday(s.day);
                        return (
                          <td 
                            key={i} 
                            onClick={() => handleDayClick(row.id, s.dateStr)}
                            style={{
                              width: '46px',
                              minWidth: '46px',
                              padding: '2px',
                              borderRight: '1px solid #f1f5f9',
                              cursor: 'pointer',
                              backgroundColor: isSun ? 'rgba(254, 226, 226, 0.3)' : isSat ? 'rgba(254, 243, 199, 0.3)' : '#ffffff'
                            }}
                          >
                            <div 
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '6px',
                                margin: '0 auto',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                position: 'relative',
                                backgroundColor: 
                                  s.displayBadge === 'CE' ? '#0f766e' : 
                                  s.displayBadge === 'CU' ? '#7e22ce' : 
                                  s.displayBadge === 'P' ? '#16a34a' : 
                                  s.displayBadge === 'OT' ? '#ea580c' : 
                                  s.displayBadge === 'HD' ? '#f59e0b' : 
                                  s.displayBadge === 'H' ? '#9333ea' : 
                                  s.displayBadge === 'L' ? '#2563eb' : 
                                  s.displayBadge === 'W' ? '#fef08a' : '#fee2e2',
                                color: 
                                  s.displayBadge === 'W' ? '#854d0e' : 
                                  s.displayBadge === 'A' ? '#dc2626' : '#ffffff'
                              }}
                            >
                              {s.displayBadge}
                                
                              {s.punches > 1 && (
                                <div style={{
                                  position: 'absolute',
                                  top: '-3px',
                                  right: '-3px',
                                  backgroundColor: '#1d4ed8',
                                  color: '#ffffff',
                                  fontSize: '8px',
                                  width: '14px',
                                  height: '14px',
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  border: '1px solid #ffffff'
                                }}>
                                  {s.punches}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* 1. కేవలం స్వచ్ఛమైన P మాత్రమే */}
                      <td style={{ width: '55px', fontWeight: 'bold', color: '#15803d', borderRight: '1px solid #cbd5e1' }}>{row.stats.Present}</td>
                      
                      {/* 2. కేవలం స్వచ్ఛమైన CE మాత్రమే */}
                      <td style={{ width: '65px', fontWeight: 'bold', color: '#0f766e', borderRight: '1px solid #cbd5e1' }}>
                        {row.totalCoffsEarned.toFixed(1)}
                      </td>

                      {/* 3. కేవలం స్వచ్ఛమైన OT మాత్రమే */}
                      <td style={{ width: '55px', fontWeight: 'bold', color: '#c2410c', borderRight: '1px solid #cbd5e1' }}>{row.stats.totalOT}h</td>

                      <td style={{ width: '45px', fontWeight: 'bold', color: '#dc2626', borderRight: '1px solid #cbd5e1' }}>{row.stats.Absent}</td>
                      <td style={{ width: '45px', fontWeight: 'bold', color: '#b45309', borderRight: '1px solid #cbd5e1' }}>{row.stats['Week-off']}</td>
                      <td style={{ width: '45px', fontWeight: 'bold', color: '#7e22ce', borderRight: '1px solid #cbd5e1' }}>{row.stats.Holiday}</td>
                      
                      <td style={{ width: '65px', fontWeight: 'bold', color: '#6b21a8', borderRight: '1px solid #cbd5e1' }}>
                        {row.totalCoffsUsed.toFixed(1)}
                      </td>
                      
                      <td style={{ width: '50px', fontWeight: 'bold', color: '#ef4444', borderRight: '1px solid #cbd5e1' }}>{row.totalLateHoursCut.toFixed(1)}</td>
                      
                      {/* Paid Days: P + W + H + OT Days */}
                      <td style={{ width: '60px', fontWeight: '900', color: '#1d4ed8', backgroundColor: '#f8fafc', borderRight: '1px solid #cbd5e1' }}>{row.paidWorkingDays}</td>
                      
                      {/* Paid Days ఆధారంగా లెక్కింపబడిన Net Salary */}
                      <td style={{ width: '120px', fontWeight: 'bold', color: '#1e3a8a', backgroundColor: '#ffffff', whiteSpace: 'nowrap' }}>
                        ₹{Math.round(row.salary).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr style={{ backgroundColor: '#f8fafc', height: '48px', fontWeight: 'bold', borderTop: '2px solid #cbd5e1' }}>
                    <td style={{ width: '180px', padding: '8px 12px', textAlign: 'left', borderRight: '2px solid #cbd5e1', fontWeight: '900', whiteSpace: 'nowrap' }}>Grand Total</td>
                    
                    {daysInCycle.map((_, i) => (
                      <td key={`ft-date-${i}`} style={{ width: '46px', minWidth: '46px', color: '#94a3b8', borderRight: '1px solid #f1f5f9' }}>-</td>
                    ))}

                    <td title="Total Present Only" style={{ width: '55px', color: '#15803d', borderRight: '1px solid #cbd5e1', backgroundColor: '#dcfce7' }}>{grandTotals.present}</td>
                    <td title="Total C-offs Earned" style={{ width: '65px', color: '#0f766e', borderRight: '1px solid #cbd5e1', backgroundColor: '#ccfbf1' }}>{grandTotals.coffsEarned.toFixed(1)}</td>
                    <td title="Total Overtime" style={{ width: '55px', color: '#c2410c', borderRight: '1px solid #cbd5e1', backgroundColor: '#ffedd5' }}>{grandTotals.ot}h</td>
                    
                    <td title="Total Absent" style={{ width: '45px', color: '#b91c1c', borderRight: '1px solid #cbd5e1', backgroundColor: '#fee2e2' }}>{grandTotals.absent}</td>
                    <td title="Total Week-offs" style={{ width: '45px', color: '#b45309', borderRight: '1px solid #cbd5e1', backgroundColor: '#fef3c7' }}>{grandTotals.weekoff}</td>
                    <td title="Total Holidays" style={{ width: '45px', color: '#7e22ce', borderRight: '1px solid #cbd5e1', backgroundColor: '#f3e8ff' }}>{grandTotals.holiday}</td>
                    <td title="Total C-offs Used" style={{ width: '65px', color: '#6b21a8', borderRight: '1px solid #cbd5e1', backgroundColor: '#fae8ff' }}>{grandTotals.coffsUsed.toFixed(1)}</td>
                    
                    <td title="Total Late Hours" style={{ width: '50px', color: '#dc2626', borderRight: '1px solid #cbd5e1' }}>{reportData.reduce((acc, r) => acc + r.totalLateHoursCut, 0).toFixed(1)}</td>
                    <td title="Total Paid Days" style={{ width: '60px', color: '#1d4ed8', backgroundColor: '#eff6ff', borderRight: '1px solid #cbd5e1' }}>{grandTotals.paidWorkingDays.toFixed(1)}</td>
                    <td title="Total Net Salary" style={{ width: '120px', color: '#1e3a8a', backgroundColor: '#dbeafe', whiteSpace: 'nowrap' }}>₹{Math.round(grandTotals.salary).toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* మోడల్ డైలాగ్ */}
      <Dialog open={!!editingDay} onOpenChange={() => setEditingDay(null)}>
        <DialogContent className="w-[95%] max-w-[450px] rounded-2xl sm:rounded-lg overflow-hidden p-0 border-none shadow-2xl">
          <DialogHeader className="p-5 bg-primary text-primary-foreground">
            <DialogTitle className="text-lg">Update Attendance & Benefit - {editingDay?.date}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 p-5 bg-white max-h-[80vh] overflow-y-auto">
            
            <div className="grid gap-2">
              <Label className="text-xs font-bold text-slate-700">Day Status (హాజరు రకం)</Label>
              <Select value={editForm.status} onValueChange={(v) => {
                setEditForm(p => ({ 
                  ...p, 
                  status: v, 
                  ot: (v === 'OT' && (p.ot === '0' || !p.ot)) ? '8' : p.ot,
                  extraShiftBenefit: v === 'Present' ? 'None' : (v === 'C-off' ? 'C-off Used' : p.extraShiftBenefit)
                }));
              }}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">Reset (Auto Mode)</SelectItem>
                  <SelectItem value="Present">Present (సాధారణ హాజరు - P)</SelectItem>
                  <SelectItem value="OT">OT Duty (ఓవర్‌టైమ్ డ్యూటీ - OT)</SelectItem>
                  <SelectItem value="Half-Day">Half-Day (సగం రోజు - HD)</SelectItem>
                  <SelectItem value="Week-off">Week-off (వారపు సెలవు - W)</SelectItem>
                  <SelectItem value="Holiday">Company Holiday (కంపెనీ సెలవు - H)</SelectItem>
                  <SelectItem value="Leave">Leave (సెలవు / Unpaid - L)</SelectItem>
                  <SelectItem value="Absent">Absent (గైర్హాజరు - A)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="p-3.5 border rounded-xl bg-teal-50/60 border-teal-200 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-teal-950 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-teal-700" /> Benefit Type (ప్రయోజనం రకం)
                </Label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-teal-300 text-teal-800">
                  {editForm.extraShiftBenefit}
                </span>
              </div>

              <Select 
                value={editForm.extraShiftBenefit} 
                onValueChange={(v: 'None' | 'C-off Earned' | 'C-off Used' | 'OT') => {
                  setEditForm(p => ({ 
                    ...p, 
                    extraShiftBenefit: v,
                    status: v === 'C-off Used' ? 'C-off' : (v === 'C-off Earned' ? 'Present' : p.status)
                  }));
                }}
              >
                <SelectTrigger className="bg-white h-10 rounded-lg text-xs font-bold border-teal-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">Regular / None (సాధారణ రోజు - P)</SelectItem>
                  <SelectItem value="C-off Earned">C-off Earned (CE - క్రెడిట్ మాత్రమే)</SelectItem>
                  <SelectItem value="C-off Used">C-off Used (CU - సెలవు వాడుకున్నారు)</SelectItem>
                  <SelectItem value="OT">Overtime Pay (OT Pay)</SelectItem>
                </SelectContent>
              </Select>

              {(editForm.extraShiftBenefit === 'C-off Earned' || editForm.extraShiftBenefit === 'C-off Used') && (
                <div className="pt-1 space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-teal-800 block">
                    {editForm.extraShiftBenefit === 'C-off Earned' ? 'ఎన్ని C-off సంపాదించారు (CE)?' : 'ఎన్ని C-off వాడుకున్నారు (CU)?'}
                  </span>
                  <div className="flex gap-2">
                    {['0.5', '1', '1.5', '2'].map(qty => (
                      <Button 
                        key={qty} 
                        type="button" 
                        variant={editForm.coffQty === qty ? "default" : "outline"}
                        className={`h-8 flex-1 text-xs rounded-lg font-bold ${
                          editForm.coffQty === qty 
                            ? (editForm.extraShiftBenefit === 'C-off Earned' ? 'bg-teal-700 text-white' : 'bg-purple-700 text-white')
                            : 'bg-white text-slate-700 border-teal-200'
                        }`}
                        onClick={() => setEditForm(p => ({ ...p, coffQty: qty, ot: (parseFloat(qty) * 8).toString() }))}
                      >
                        {qty} C-off
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(editForm.status === 'Present' || editForm.status === 'OT' || editForm.status === 'None') && (
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                <Label className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-700" /> HR Duty Timings
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">In Time</span>
                    <Input 
                      type="time" 
                      className="h-9 bg-white rounded-lg border-blue-200 text-xs font-semibold"
                      value={editForm.inTime} 
                      onChange={(e) => handleTimingChange(e.target.value, editForm.outTime)} 
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Out Time</span>
                    <Input 
                      type="time" 
                      className="h-9 bg-white rounded-lg border-blue-200 text-xs font-semibold"
                      value={editForm.outTime} 
                      onChange={(e) => handleTimingChange(editForm.inTime, e.target.value)} 
                    />
                  </div>
                </div>
              </div>
            )}

            {editForm.extraShiftBenefit === 'OT' && (
              <div className="p-3 border rounded-xl bg-orange-50/50 border-orange-200 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-orange-950">OT Hours</Label>
                  <span className="text-xs font-black text-orange-600 bg-orange-100 px-2 py-0.5 rounded-md">{editForm.ot}h OT</span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {['0', '1', '2', '4', '8'].map(hrs => (
                    <Button 
                      key={hrs} 
                      type="button" 
                      variant={editForm.ot === hrs ? "default" : "outline"}
                      className={`h-7 px-2.5 text-xs rounded-md ${editForm.ot === hrs ? 'bg-orange-600 text-white font-bold' : 'bg-white text-slate-700 border-orange-200'}`}
                      onClick={() => setEditForm(p => ({ ...p, ot: hrs }))}
                    >
                      {hrs === '0' ? 'No OT' : hrs === '8' ? 'Full Shift (8h)' : `+${hrs}h`}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase font-bold text-slate-500">Late-In (గంటలు)</Label>
                <Input 
                  type="number" 
                  step="0.1" 
                  className="h-9 rounded-lg text-xs" 
                  placeholder={editingDay?.autoLate.toFixed(2) || "0"} 
                  value={editForm.lateIn} 
                  onChange={(e) => setEditForm(p => ({ ...p, lateIn: e.target.value }))} 
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase font-bold text-slate-500">Early Out (గంటలు)</Label>
                <Input 
                  type="number" 
                  step="0.1" 
                  className="h-9 rounded-lg text-xs" 
                  placeholder="0" 
                  value={editForm.earlyOut} 
                  onChange={(e) => setEditForm(p => ({ ...p, earlyOut: e.target.value }))} 
                />
              </div>
            </div>

          </div>
          
          <DialogFooter className="p-4 bg-slate-50 flex gap-2">
            <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setEditingDay(null)}>Cancel</Button>
            <Button onClick={saveDayStatus} className="flex-1 h-11 rounded-xl bg-primary text-white font-bold">Save Attendance</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
