import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT = DATA_DIR / 'faq_dataset.jsonl'

def variants(source, source_file, facts):
    rows = []
    for i, (topic, q1, q2, answer, pages, category, keys) in enumerate(facts, 1):
        resolved_files = source_file if isinstance(source_file, list) else [source_file]
        if source == 'Cross-document':
            page_text = str(pages)
            resolved_files = [
                filename for filename in resolved_files
                if ('BITSAT-2026' in page_text and 'BITSAT-2026' in filename)
                or (('FD-Admission-Modality' in page_text or 'FD ' in page_text or 'FD pages' in page_text) and 'Admission_Modality_FD' in filename)
                or (('BITS-HD-2025-26' in page_text or 'HD ' in page_text or 'HD page' in page_text) and 'HD_Brochure_2025_26' in filename)
            ] or resolved_files
        for j, q in enumerate((q1, q2), 1):
            rows.append({
                'id': f'{source}-{i:03d}-{j}',
                'question': q,
                'answer': answer,
                'source': source,
                'source_files': resolved_files,
                'source_pages': [str(pages)],
                'admission_year': {'BITSAT-2026': '2026-27', 'FD-Admission-Modality': '2022-23', 'BITS-HD-2025-26': '2025-26', 'Cross-document': 'Multiple cycles'}[source],
                'category': category,
                'keywords': keys,
            })
    return rows

bitsat = [
('scope','What is BITSAT-2026 used for?','Which admissions does BITSAT-2026 cover?','It is the computer-based online test used for admission to Integrated First Degree programmes at the Pilani, K K Birla Goa, and Hyderabad campuses for academic year 2026-27.','2','overview','BITSAT, 2026, integrated first degree'),
('pilani-programmes','Which B.E. programmes are listed for the Pilani campus?','What B.E. options does the Pilani campus offer through BITSAT-2026?','The brochure lists Chemical, Civil, Computer Science, Electrical and Electronics, Electronics and Instrumentation, Electronics and Communication, Mathematics and Computing, Mechanical, Manufacturing Engineering, Environmental and Sustainability Engineering, and Pharmaceutical Engineering.','2','programmes','Pilani, B.E., programmes'),
('goa-programmes','Which B.E. programmes are listed for the Goa campus?','What engineering programmes are available at K K Birla Goa through BITSAT-2026?','The listed options are Chemical, Computer Science, Electronics and Communication, Electrical and Electronics, Electronics and Instrumentation, Electronics and Computer Engineering, Mathematics and Computing, Mechanical, and Environmental and Sustainability Engineering.','2','programmes','Goa, engineering'),
('hyd-programmes','Which B.E. programmes are listed for Hyderabad?','What engineering programmes are listed for the Hyderabad campus?','The brochure lists Chemical, Civil, Computer Science, Electronics and Communication, Electrical and Electronics, Electronics and Instrumentation, Mathematics and Computing, Mechanical, Environmental and Sustainability Engineering, and Pharmaceutical Engineering.','2','programmes','Hyderabad, engineering'),
('msc','Which M.Sc. programmes are offered through BITSAT-2026?','What M.Sc. choices are listed in the BITSAT-2026 brochure?','The listed programmes are Biological Sciences, Chemistry, Economics, Mathematics, Physics, Semiconductor and Nanoscience, plus M.Sc. General Studies at Pilani.','2','programmes','M.Sc., science'),
('dual-degree','Can an M.Sc. student apply for an engineering dual degree?','How does the M.Sc. dual-degree option work?','Students joining an M.Sc. programme may apply for an engineering dual degree after completing first year; allocation is competitive and based on performance at BITS. PCB-entry M.Sc. Biological Sciences students are limited to B.E. Environmental and Sustainability Engineering and B.Pharm. for this option.','2-5','academic-flexibility','dual degree, M.Sc.'),
('collab-22','What is the 2+2 international collaborative programme?','How is the 2+2 joint programme structured?','Students spend the first two years at a BITS Pilani campus in India and the remaining two years at a selected partner university abroad. The brochure gives examples in Australia, the USA, and France.','3-4','academic-flexibility','2+2, international'),
('intercampus','What is the 3+2 B.E.-MBA programme?','How long is the BITS STEM campus and BITSOM MBA pathway?','It combines three years of B.E. at a BITS STEM campus in India with two years of MBA at BITSOM, Mumbai, for a five-year integrated degree pathway.','3-4','academic-flexibility','3+2, MBA, BITSOM'),
('board-topper','Do board toppers receive direct admission?','What direct-admission route is available to first-rank board students?','First-rank students of State and Central boards in India for 2026 may receive direct admission to the programme of their choice, subject to the brochure eligibility criteria, irrespective of their BITSAT score.','3','admission-modes','board topper'),
('pcm-eligibility','What are the PCM eligibility marks for most B.E. and M.Sc. programmes?','What PCM percentage is required for BITSAT-2026 eligibility?','Candidates need at least 75% aggregate in Physics, Chemistry and Mathematics, with at least 60% in each of those subjects. Theory and practical marks are included.','3-4','eligibility','PCM, 75%, 60%'),
('pcb-eligibility','What are the PCB eligibility marks for B.Pharm. and specified programmes?','What marks are required for B.Pharm. or PCB-entry programmes?','Candidates need at least 75% aggregate in Physics, Chemistry and Biology or Mathematics, with at least 60% in each subject. Theory and practical components are included.','4','eligibility','PCB, B.Pharm., marks'),
('five-subjects-pcm','How many subjects are required for PCM-entry programmes?','What subject combination is required for most B.E. and M.Sc. programmes?','At least five subjects are required: Physics, Chemistry, Mathematics, one language, and one additional subject.','3','eligibility','five subjects, PCM'),
('five-subjects-pcb','What subjects are required for PCB-entry programmes?','What is the five-subject requirement for B.Pharm. and PCB-entry programmes?','At least five subjects are required: Physics, Chemistry, Biology or Mathematics, one language, and one additional subject.','4','eligibility','five subjects, PCB'),
('pcb-math','Do PCB entrants need Mathematics proficiency?','Is Class 10 Mathematics proficiency required for PCB-entry students?','Students entering through PCB at 10+2 level should possess mathematics proficiency at the high-school/Class 10 level.','4','eligibility','PCB, Class 10 mathematics'),
('eligible-years','Who can appear for BITSAT-2026 based on passing year?','Which 12th-grade batches are eligible to appear?','Students appearing for the 12th examination in 2026 or who passed it in 2025 may appear, subject to the other requirements and timely result availability.','5','eligibility','2025, 2026, 12th'),
('improvement','Can a 2026 student take improvement examinations and remain eligible?','Are improvement-exam candidates eligible for BITSAT-2026?','A 2026 candidate may reappear for improvement in specific subjects if the improved results are available by the submission deadline and the candidate’s Pass status remains unchanged.','5','eligibility','improvement, pass status'),
('old-passout','Are students who passed 12th in 2024 or earlier eligible?','Can a candidate who passed before 2025 apply for BITSAT-2026?','No. The brochure states that students who passed the 12th examination in 2024 or earlier are not eligible.','5','eligibility','2024, ineligible'),
('current-bits','Can a student already enrolled at BITS appear for BITSAT-2026?','Are current BITS students eligible for BITSAT-2026?','No. Students currently enrolled in any programme at a BITS campus are not eligible to appear.','5','eligibility','current student, restriction'),
('caie-ib','What does the brochure require from CAIE and IB students?','How are Cambridge and IB qualifications treated?','CAIE candidates must complete the required subjects at A Level; IB candidates must complete them at Higher Level to satisfy eligibility.','5','eligibility','CAIE, IB, A Level, Higher Level'),
('merit','How is the BITSAT-2026 merit position prepared?','What determines admission merit?','For eligible candidates who submit the admission form, 12th marks, programme preferences, and required fees, merit is prepared using the BITSAT-2026 score.','8','admission-process','merit, score'),
('higher-score','Which score counts if a candidate takes BITSAT twice?','Is the higher or lower BITSAT score used?','If a candidate appears twice, the higher of the two BITSAT-2026 scores is considered for admission.','6','test-rules','two attempts, higher score'),
('max-attempts','How many times may a candidate take BITSAT-2026?','What is the maximum number of BITSAT-2026 attempts?','A candidate may appear a maximum of two times, through Session 1 and Session 2.','6','test-rules','two attempts'),
('sessions','What are the two BITSAT-2026 sessions?','How is BITSAT-2026 divided into sessions?','The examination is organized in Session 1 and Session 2, separated by a few weeks; candidates may opt for one or both subject to the application windows.','6','test-rules','Session 1, Session 2'),
('session2-only','Can a candidate apply only for Session 2?','How does a Session-2-only application work?','Yes. A candidate wanting only Session 2 must apply during the second application window.','6','application','Session 2 only'),
('fee-indian-one','What is the Indian/Nepal centre fee for one session?','How much is the one-session BITSAT fee at Indian or Nepal centres?','The brochure lists Rs. 3,600 for male candidates and Rs. 3,100 for female or transgender candidates for only Session 1 or Session 2.','6','fees','application fee, Indian centre'),
('fee-indian-both','What is the fee for both sessions at Indian/Nepal centres?','How much does a two-session Indian/Nepal application cost?','The brochure lists Rs. 5,600 for male candidates and Rs. 4,600 for female or transgender candidates for both sessions.','6','fees','both sessions, fee'),
('fee-dubai','What is the Dubai test-centre fee?','How much does BITSAT cost at Dubai?','The listed Dubai fee is Rs. 7,250 for one session and Rs. 9,250 for both sessions, for male, female, or transgender candidates.','6','fees','Dubai, fee'),
('fee-session2','What is the additional fee after applying for Session 1?','How much is charged when a Session-1 applicant applies separately for Session 2?','The additional fee is Rs. 2,000 for a male candidate, Rs. 1,500 for a female candidate, and Rs. 1,500 for a transgender candidate at Indian/Nepal centres; Dubai has an additional Rs. 2,000 in the listed case.','6','fees','additional fee, Session 2'),
('nonrefund','Is the BITSAT application fee refundable or transferable?','Can the BITSAT application fee be refunded or transferred?','No. The brochure states that the application fee is non-refundable and non-transferable.','6','fees','non-refundable, non-transferable'),
('duration','How long is each BITSAT session?','What is the duration of the BITSAT-2026 test?','Each session lasts three hours without a break.','7','test-format','three hours'),
('parts','What parts are included in BITSAT-2026?','Which subjects make up the BITSAT test?','The four parts are Physics; Chemistry; English Proficiency and Logical Reasoning; and Mathematics or Biology depending on the programme.','7','test-format','Physics, Chemistry, English, Logical Reasoning'),
('questions','How many questions are in BITSAT-2026?','What is the total question count?','There are 130 objective questions in the standard test.','7','test-format','130 questions'),
('distribution','How are the 130 questions distributed?','How many questions come from each BITSAT section?','Physics has 30, Chemistry 30, English Proficiency 10, Logical Reasoning 20, and Mathematics or Biology 40.','7','test-format','question distribution'),
('marking','What is the BITSAT marking scheme?','How are correct and incorrect answers scored?','A correct answer earns 3 marks; an incorrect answer incurs a penalty of 1 mark. Unattempted questions receive no marks.','7','test-format','3 marks, -1'),
('skip','Must every BITSAT question be attempted?','Can a candidate leave questions unanswered?','No. Attempting every question is not mandatory; skipped questions receive no marks and no penalty.','7','test-format','skip, unanswered'),
('navigation','Can a candidate change answers during the test?','Can candidates revisit questions?','There is no separate time limit for individual parts, and candidates can go back and change answers among the 130 questions.','7','test-format','change answers'),
('extra','When are extra questions available?','How can a candidate attempt the 12 extra questions?','After answering all 130 questions without skipping, a candidate may attempt up to 12 extra questions if time remains. They cover Physics, Chemistry, Mathematics/Biology, and Logical Reasoning, with three from each.','7','test-format','extra questions'),
('extra-lock','Can answers be changed after starting extra questions?','What happens to earlier answers once extra questions are selected?','No. Once the candidate opts for extra questions, they cannot return to correct any of the earlier 130 answers.','7','test-format','extra questions, correction'),
('english','Are BITSAT questions available in languages other than English?','What is the language of BITSAT questions and instructions?','All questions and test instructions are in English only.','7','test-rules','English only'),
('calculator','Are calculators allowed in BITSAT?','Can candidates bring a calculator or electronic device?','No. Calculators, digital or electronic devices, mobile phones, logarithmic tables, and other unauthorized material are prohibited.','8','test-rules','calculator, prohibited'),
('scratch','Is rough work material provided?','What should a candidate do for rough work?','Candidates should bring a pen; a scratch pad is provided at the test centre and must be returned before leaving.','7-8','test-rules','scratch pad'),
('hall-ticket','What is required to enter the test centre?','Can a candidate enter without a hall ticket?','Only candidates with the downloaded hall ticket are allowed inside the test centre.','8','test-rules','hall ticket'),
('security','How are candidates verified?','What security measures are used at BITSAT centres?','Centres use web cameras and/or CCTV, and candidate fingerprints and photographs are taken and later matched at admission.','8','test-rules','security, biometrics'),
('score-report','When is the BITSAT score reported?','How does a candidate obtain the score report?','The computer displays correct answers, wrong answers, and the score at completion. The score report can also be checked on the admission website after a few days and printed.','8','results','score report'),
('tie1','What is the first BITSAT tie-breaker?','Which subject is used first when BITSAT scores are tied?','Mathematics is considered first, or Biology for B.Pharm., B.E. Environmental and Sustainability Engineering, and PCB-entry M.Sc. Biological Sciences.','8','merit','tie-breaker'),
('tie2','What is the next tie-breaker after Mathematics or Biology?','How is a remaining BITSAT tie resolved after the first subject?','Physics is considered next, followed by Chemistry.','8','merit','tie-breaker, Physics, Chemistry'),
('tie3','What are later BITSAT tie-breakers?','How are final ties handled?','The total positive aggregate marks are considered; if still tied, preference goes to the female candidate, then to the candidate with the older application.','8','merit','tie-breaker, female, application'),
('centres','How are Indian test centres selected?','How many centre preferences can an applicant give in India?','Applicants for Indian centres give three preferences and are allotted one of them, subject to the final list and availability.','9','test-centres','three preferences'),
('kathmandu','Can Kathmandu applicants give Indian centre choices too?','What centre preferences may a Kathmandu applicant provide?','A candidate applying for Kathmandu may provide two additional centre options in India.','9','test-centres','Kathmandu'),
('dubai-kuwait','What happens when Dubai or Kuwait is selected?','Can Dubai or Kuwait applicants choose other centres?','If Dubai or Kuwait is chosen, no other centre preference is requested; the candidate is allotted that centre according to the preference.','9','test-centres','Dubai, Kuwait'),
('auto-slot','What happens if a candidate does not book a slot?','Will the system allocate a date automatically?','Yes. If the candidate does not book the test date and slot during the booking period, the system automatically allocates them based on preferences and available slots.','9-10','test-centres','slot booking'),
('dates-start','When did BITSAT-2026 applications start?','What is the listed start date for BITSAT-2026 applications?','The tentative start date listed is 15 December 2025.','10','dates','application start'),
('dates-session1','What are the tentative Session-1 dates?','When is BITSAT-2026 Session 1 scheduled?','Session 1 is tentatively scheduled for 15-17 April 2026, although dates and operating days may vary by centre.','10','dates','Session 1 dates'),
('dates-session2','What are the tentative Session-2 dates?','When is BITSAT-2026 Session 2 scheduled?','Session 2 is tentatively scheduled for 25-27 May 2026, subject to centre-specific variation.','10','dates','Session 2 dates'),
('admission-form','Must a BITSAT candidate also submit an admission form?','Is appearing in BITSAT alone enough for admission consideration?','No. Candidates must separately apply for admission, submit 12th marks and programme preferences, and pay the required admission-form fee.','11','application','admission form, preferences'),
('marks-deadline','When are 12th marks and preferences submitted?','What is the listed admission application window?','The brochure lists 29 April to 1 June 2026 for submitting 12th marks and programme preferences, subject to official updates.','10-11','dates','12th marks, preferences'),
('late-results','What if a 2026 Class XII result is not declared by 1 June?','Can candidates with delayed results submit marks later?','Candidates whose results are not declared by 1 June, including some NIOS or delayed-result cases, may submit marks and upload the certificate by 10 July 2026, but must submit the preference form and applicable fee within the initial window.','10-11','documents','delayed result, NIOS'),
('issued-marksheet','What if the 2026 marksheet is already issued?','Must an issued Class XII marksheet be uploaded?','Yes. If the board has issued the 2026 marksheet or certificate, it must be uploaded during the admission application; failure may lead to rejection.','10','documents','marksheet upload'),
('correction','Which details cannot be changed in the edit window?','Can all BITSAT application fields be edited?','The brochure says corrections can be made online during the stated window, except gender, email ID, contact number, and test city.','13','application','edit window'),
('aadhaar','Why must personal details match Aadhaar?','What identity-document consistency is required?','Personal details in the application should match the Aadhaar Card; discrepancies may lead to application cancellation, and Aadhaar must be carried for verification.','13','documents','Aadhaar'),
('pwd','How can a PwD candidate request extra facilities?','What should a benchmark-disability candidate do before the exam?','A candidate with a prescribed disability certificate should email details to bitsat@pilani.bits-pilani.ac.in with subject “PWD CANDIDATE”. A scribe, if required, may be assigned at a BITS campus subject to the Admissions Committee decision.','14','accessibility','PwD, scribe'),
('fraud','How can applicants avoid admission fraud?','What is the official source for admission information?','Applicants should rely only on admissions.bits-pilani.ac.in and should not trust calls, messages, agents, or third parties promising direct admission.','15','safety','fraud, official website'),
('malpractice','What are the consequences of unfair means?','What happens if malpractice is established?','The brochure states that a student may be rusticated without prior notice, paid fees may be forfeited, and legal proceedings may follow, even if misconduct is discovered later.','15','conduct','malpractice'),
('payment-email','Where should fee-payment issues be sent?','What email is listed for BITSAT payment gateway problems?','Payment gateway or application-fee issues should be sent to admn.payment@pilani.bits-pilani.ac.in.','14-16','contact','payment email'),
('general-email','Where should other BITSAT queries be sent?','What email handles non-payment BITSAT queries?','Queries about application filling, admissions, and programmes should be sent to bitsat@pilani.bits-pilani.ac.in.','14-16','contact','BITSAT email'),
('syllabus-source','What syllabus reference is suggested?','Which study material does the brochure recommend for BITSAT content?','The detailed syllabus is in Annexure 1, and candidates may refer to NCERT textbooks for the contents.','8,17-19','syllabus','NCERT'),
('physics-topics','What major Physics areas are in the BITSAT syllabus?','Which Physics topics should a BITSAT candidate cover?','The syllabus includes mechanics, gravitation, oscillations and waves, thermodynamics, electrostatics, current electricity, magnetism, induction, optics, modern physics, and electronic devices.','17-19','syllabus','Physics syllabus'),
('chemistry-topics','What Chemistry areas are listed for BITSAT?','Which Chemistry domains appear in the BITSAT syllabus?','The syllabus begins with states of matter, measurement, chemical reactions, atomic and molecular concepts, gas laws, liquids, solids, and related chemistry topics in the annexure.','19','syllabus','Chemistry syllabus'),
('english-topics','What does English Proficiency cover?','Which English skills are tested?','The English component covers grammar, vocabulary, reading comprehension, and composition.','7,19','syllabus','English proficiency'),
('logical-topics','What does Logical Reasoning cover?','Which reasoning skills are listed?','The syllabus includes verbal reasoning such as analogy, classification, series completion, passage deduction, and chart logic, plus nonverbal pattern, figure, paper-cutting, matrix, and rule-detection tasks.','7,19-20','syllabus','logical reasoning'),
]

fd = [
('scope','What is the admission scope of the FD document?','Which admissions are described in the FD admission-modality document?','It describes admission modalities for Integrated First Degree programmes, including BITSAT, Board Toppers, and International Students admission schemes. The document is dated for the 2022 admission cycle.','1','overview','FD, admission modality, 2022'),
('medium','What is the medium of instruction?','In which language are BITS programmes taught according to the document?','English is the medium of instruction for all programmes in the Institute.','1','general','English, medium'),
('all-india','Are FD admissions restricted to a region?','Is admission made on an all-India basis?','Admissions are made on an all-India basis.','1','general','all India'),
('selection','What factors influence FD selection?','How does the document describe the selection basis?','Selection is based on the candidate’s merit, preferences, facilities available, and availability of seats.','1','admission-process','merit, preferences, seats'),
('bitsat-route','What is the BITSAT route in the FD document?','How is merit determined under the BITSAT scheme?','Admission is based on merit using the score obtained in the BITS computer-based online BITSAT.','1','admission-modes','BITSAT, merit'),
('route-eligibility','Who can use the BITSAT admission route?','Is the BITSAT route open to international students?','The document states that the route is open to Indian and international students; a student without a non-Indian passport can use this route for admission.','1','admission-modes','international, BITSAT'),
('fd-12th','What basic qualification is required for FD admission?','What school qualification is required for Integrated First Degree programmes?','Candidates must pass the 12th examination under the 10+2 system from a recognized Central or State board or equivalent, with adequate English proficiency.','1-2','eligibility','12th, 10+2'),
('fd-pcm','What subjects are required for most FD programmes?','What subject combination is required outside B.Pharm.?','Except for B.Pharm., candidates should have Physics, Chemistry, and Mathematics.','2','eligibility','PCM'),
('fd-bpharm','What subjects are accepted for B.Pharm.?','Does B.Pharm. accept Biology or Mathematics?','For B.Pharm., candidates should have Physics, Chemistry, and either Biology or Mathematics.','2','eligibility','B.Pharm., PCB, PCM'),
('fd-marks','What minimum subject marks are listed for FD admission?','What aggregate and individual marks are required?','The document lists 75% aggregate in Physics, Chemistry and Mathematics if Mathematics is used in BITSAT, or Physics, Chemistry and Biology if Biology is used, with at least 60% in each subject.','2','eligibility','75%, 60%'),
('latest-performance','Which 12th result is considered?','How are multiple 12th attempts treated?','Only the latest performance in a full prescribed subject component is considered, provided the latest result is available by the due date.','2','eligibility','latest performance'),
('bits-student','Can a current BITS student appear for the old BITSAT route?','Are currently enrolled BITS students eligible in the FD document?','No. Students presently studying at any BITS campus are stated to be ineligible to appear in BITSAT.','2','eligibility','current student'),
('single-form','Is one form enough for engineering and M.Sc. programmes?','How many forms are needed for M.Sc. and engineering choices?','One application form covers all M.Sc. and engineering programmes at Pilani, Goa, and Hyderabad; B.Pharm. requires a separate form.','3','application','single form, B.Pharm.'),
('preferences','How are programme preferences processed?','What happens after a candidate submits preferences?','The order of preferences across campuses and programmes is processed by computer software, with offers made accordingly and status provided through the admissions website.','3','admission-process','preferences, iterations'),
('tie-bitsat','How are equal BITSAT scores separated in the FD document?','What is the old FD tie-breaking order?','The order is Mathematics or Biology, then Physics, then Chemistry, and finally PCM marks in the 12th examination.','3','merit','tie-breaker'),
('data-final','Can application data be changed during admission iterations?','Is the submitted background and preference data final?','The submitted background, academic performance, and programme preference information is treated as final, subject to the stated editing window.','4','application','data, preferences'),
('advance-fees','What is required to remain in the admission process?','Must the required fees be paid in advance?','Yes. Required fees communicated by the Institute must be paid in advance to remain in the process.','4','fees','advance fee'),
('withdraw','Can a candidate withdraw from the competition?','What choice does a candidate have after a provisional offer or waitlist placement?','A candidate may choose to remain in the competition or withdraw within the stipulated deadline published by the Institute.','4','admission-process','withdraw, waitlist'),
('seat-ratio','Are seat counts fixed each year?','Why may total admissions vary?','Facilities are described through seat ratios rather than fixed numbers, and total admissions may vary to support flexibility such as dual degree and transfer.','4','admission-process','seats, flexibility'),
('overoffer','Can BITS make more offers than available seats?','Why might the Institute over-offer?','Based on past responses and statistical projections, the Institute may make offers to more candidates than the number of earmarked seats.','4','admission-process','offers, seats'),
('assignment','How are seats assigned?','What is the computer’s seat-assignment order?','The computer starts with the first candidate on the merit list, tries the candidate’s first preference, and proceeds down the preference list if necessary.','4-5','admission-process','assignment, preferences'),
('waitlist','What is the BITS waitlist for?','Is the waitlist tied to a particular programme?','The waitlist is for admission to the Institute, not a particular programme, so a programme-specific waitlist number is not assigned.','5','waitlist','waitlist'),
('higher-score-wait','Can a higher-score candidate wait while a lower-score candidate is admitted?','Why might a lower BITSAT scorer receive an offer first?','Yes. A higher-scoring candidate may have crossed out a programme while a lower-scoring candidate selected it and seats were available there.','5','waitlist','score, crossed out'),
('cross-out','What happens if a candidate crosses out a programme?','Does crossing out affect waitlist consideration?','The candidate stops being considered for that programme and for its waitlist.','5','preferences','cross out'),
('waitlist-fee','Must a waitlisted candidate pay fees?','What keeps a candidate on the waitlist?','Candidates receiving waitlist offers must pay the required fees in advance to remain on the waitlist.','5-6','fees','waitlist fee'),
('freeze','What does the Freeze option mean?','Can a candidate reverse Freeze?','Freeze opts the candidate out of all higher-preference programmes and cannot be reversed; it should be selected only after careful consideration.','6','preferences','Freeze'),
('slide','What does Slide in the same campus mean?','How does the same-campus Slide option work?','It removes higher preferences at other campuses while retaining higher preferences at the campus where admission was offered. The decision cannot be reversed.','6-7','preferences','Slide, campus'),
('default-float','What happens if neither Freeze nor Slide is selected?','Does a candidate continue in higher-preference consideration by default?','Yes. Without either option, the candidate remains under consideration for all higher preferences listed in the application.','7','preferences','higher preferences'),
('edit-window','Was an editing window provided in the old FD process?','When could a preference mistake be edited in the cited cycle?','The document cites an editing window of 7-10 September 2022 for preference mistakes. This is historical and must not be assumed current.','7','dates','editing, 2022'),
('campus-process','Is admission to the three Indian campuses separate?','How are Pilani, Goa, and Hyderabad admissions linked?','They use a single admission process, and an offer at one campus may slide to a higher preference at another campus in a later iteration.','7','admission-process','Pilani, Goa, Hyderabad'),
('reporting','Can a student remain on higher-preference waitlists after reporting?','What happens after reporting at one campus?','After reporting at a campus, the student remains on the waitlist for higher preferences at other campuses until admissions are finalized.','7','waitlist','reporting'),
('dual-degree','How are dual degrees allocated to M.Sc. students?','When is an engineering dual degree assigned?','Assignment is competitive based on performance at BITS at the end of the first year, separately at Pilani, Goa, and Hyderabad.','7-8','academic-flexibility','dual degree, PBI'),
('dual-duration','How long do the two degrees normally take?','What is the normal duration of the dual-degree scheme?','The requirements for both degrees are structured to be completed normally in five years.','7','academic-flexibility','five years'),
('second-admission-fee','Is there a fee for the second degree?','When is the second-programme admission fee paid?','A student admitted to a second degree under the dual-degree scheme must pay the admission fee for the second programme at that time.','8','fees','dual degree fee'),
('pcb-flexibility','Are all transfer and dual-degree options available to PCB entrants?','What flexibility restriction applies to PCB-entry B.Pharm.?','The document warns that transfer and dual-degree flexibility is restricted for B.Pharm. students with PCB input; other first-degree programmes require PCM input.','8','academic-flexibility','PCB, transfer'),
('board-direct','Who qualifies for direct admission as a board topper?','What is the Board Topper direct-admission principle?','First-rank students of Central and State boards may receive direct admission to a programme of choice irrespective of BITSAT score, subject to the prescribed eligibility.','8','admission-modes','board topper'),
('board-pcm','Which programmes can a PCM board topper choose?','What can a PCM-stream first-rank student enter?','A first-rank student in the PCM stream may be considered for any first-degree programme of choice, subject to eligibility.','8','admission-modes','PCM, board topper'),
('board-pcb','What can a PCB board topper choose?','Is a PCB board topper eligible for every FD programme?','A PCB first-rank holder is considered for the B.Pharm. programme only.','8-10','admission-modes','PCB, B.Pharm.'),
('board-tie','How are multiple board toppers separated?','What tie-breakers apply if more than four first-rank holders are declared?','The cited order uses Mathematics, Physics, Chemistry, Class 10 Mathematics, and Class 10 Science marks; the committee may add criteria, including a written test.','9','merit','board topper, tie'),
('sat-route','Is an international SAT route mentioned?','How is SAT-based admission described in the FD document?','The document describes a route for which merit is determined by SAT score, including the SAT writing component, subject to the international scheme’s conditions.','12','international','SAT, ISA'),
('application-form','How should FD admission applications be submitted?','Is a prescribed application form required?','Applications should be made on the prescribed form; the document describes separate processes for different schemes.','17-19','application','application form'),
('domestic-fees','Where are domestic FD fees shown?','Which part of the FD document contains domestic fee tables?','Domestic fee tables begin in the Fees section around pages 25-27 of the cited document. The figures are for the historical 2022-23 cycle.','25-27','fees','domestic fee'),
('fees-advance','Are FD fees paid in advance?','What is the general payment rule for fees?','The document states that fees are to be paid in advance.','27','fees','advance payment'),
('refundables','Which amounts are refundable?','What does the document say about refundable deposits?','Only the caution deposit and mess advance are refundable after adjustment of dues at graduation or withdrawal, under the cited rules.','27','fees','refund, caution deposit'),
('course-fee','What is the listed course-wise fee?','Is there a per-course fee in the old FD fee section?','The cited document lists Rs. 4,200 per course for certain limited courses outside academic requirements after full semester fees are paid.','27','fees','course fee'),
('minor-fee','What fee is listed for a minor programme?','How is the old minor-programme fee paid?','For the cited 2022-23 cycle, the document lists Rs. 26,000, payable as Rs. 13,000 application fee and Rs. 13,000 certificate fee.','27','fees','minor programme'),
('isa-application','What is the ISA application fee in the historical table?','How much is the cited international application fee?','The 2022-23 ISA table lists an application fee of Rs. 6,750 for both non-SAARC and SAARC students.','28','international-fees','ISA, application fee'),
('isa-caution','What is the ISA caution deposit in the cited table?','How much is the international student caution deposit?','The cited 2022-23 ISA table lists an Institute caution deposit of Rs. 32,000, refundable on graduation or leaving after adjustment of dues.','28','international-fees','ISA, caution deposit'),
('isa-scholarship','What ISA tuition waivers are listed?','How are historical ISA scholarships distributed?','The table lists 80% for the top 4%, 50% for the next 10%, 30% for the next 20%, and 15% for the remaining students.','29,35','scholarships','ISA scholarship'),
('isa-cgpa','What CGPA is needed for later ISA waivers?','What continuing-performance thresholds are listed for ISA scholarships?','The cited policy lists a minimum CGPA of 8.0 for an 80% waiver and 6.0 for other listed waiver levels, subject to rank and other conditions.','29,35','scholarships','CGPA, ISA'),
('domestic-scholarship','What FD scholarship percentages are listed?','How does the historical FD merit/need scholarship table work?','For the cited cycle, the table lists merit awards of 100% for the top 1% and 40% for the top 2%; merit-cum-need awards list 80%, 40%, 25%, and 15% bands.','33','scholarships','FD scholarship'),
('no-admission-waiver','Is the admission fee waived by the FD scholarship?','Does the historical scholarship cover admission fees?','No. The document explicitly notes that there is no waiver of admission fee.','33','scholarships','admission fee, waiver'),
('scholarship-duration','How long does an FD scholarship last?','Are scholarships automatically continued every semester?','Awards are made for one semester; continuation depends on the student’s performance at the Institute and need.','33-35','scholarships','one semester'),
('other-aid','What other assistance is mentioned?','Which non-Institute scholarship sources are listed?','The document mentions government scholarships, State awards, SC/ST scholarships, charitable trusts, Students Aid Fund, alumni assistance, and national competitions.','34','scholarships','financial assistance'),
('records','How are student records maintained?','What does the document say about grade sheets?','Student records are computerized, and a grade sheet is normally issued within one week after the comprehensive examination.','35-36','student-records','grade sheet'),
('transcript','When is a transcript issued?','What academic record is given at programme completion?','A transcript covering performance from entry to leaving is issued to passing-out candidates, normally within four weeks of the last examination.','36','student-records','transcript'),
('id-number','What is the purpose of the student ID number?','Are BITS student ID numbers unique?','Each student receives a unique computerized ID number; no two ID numbers are identical, and the code contains programme, year, stream, and campus information.','36','student-records','ID number'),
('anti-ragging','What is the anti-ragging policy?','What may happen if anti-ragging rules are violated?','Students must sign an undertaking and violations may lead to disciplinary action, expulsion, and possible legal action.','37-38','conduct','anti-ragging'),
('wilp','Is Work Integrated Learning covered by the same form?','Where should WILP applicants look for information?','A separate application form is used for Work Integrated Learning programmes, and candidates should consult the separate WILP section and the stated WILP website.','38','application','WILP'),
('dubai-admission','How is Dubai Campus admission determined?','What is the Dubai Campus admission basis?','Dubai Campus admissions are based on merit in the qualifying examination and are open to students from all countries with recognized international-board qualifications.','38','dubai','Dubai Campus'),
('dubai-visa','Is a residence visa facilitated for Dubai students?','What visa support is mentioned for Dubai Campus?','For candidates admitted from countries other than the UAE, a student residence visa is facilitated.','38','dubai','visa, Dubai'),
]

hd = [
('scope','What does the Higher Degree brochure cover?','Which programmes and academic year are covered by the HD brochure?','It covers four-semester on-campus M.E. and M.Pharm. admissions for academic year 2025-26 at Pilani, K K Birla Goa, and Hyderabad.','2,5','overview','HD, M.E., M.Pharm.'),
('duration','How long are the Higher Degree programmes?','What is the normal duration of M.E. and M.Pharm.?','The normal duration is four semesters.','5','programme-structure','four semesters'),
('minimum','What minimum qualifying-degree marks are required?','What percentage is required for HD admission?','A minimum of 60% in the qualifying degree examination is required for M.E. and M.Pharm.','5','eligibility','60%, qualifying degree'),
('programmes','Which broad M.E. disciplines are listed?','What M.E. fields are available in the HD brochure?','The list includes Biotechnology, Chemical, Civil specializations, Communication, Computer Science, Design, Embedded Systems, Manufacturing Systems, Mechanical, Microelectronics, Software Systems, Environmental, and Electrical with Power Electronics and Drives.','5','programmes','M.E. programmes'),
('pharm','Which M.Pharm. specializations are listed?','What M.Pharm. choices are offered?','The brochure lists Pharmaceutical Chemistry, Pharmaceutics, and Pharmacology.','5','programmes','M.Pharm.'),
('campus-civil','Which campus offers Civil Infrastructure Engineering and Management?','Where is the Civil Infrastructure specialization listed?','It is listed at the Pilani campus only.','5','programmes','Civil, infrastructure, Pilani'),
('campus-software','Where is M.E. Software Systems offered?','Which campus offers Software Systems?','M.E. Software Systems is listed at Pilani only.','5','programmes','Software Systems, Pilani'),
('campus-thermal','Where is Mechanical with Thermal Engineering offered?','Which campus has the Thermal Engineering specialization?','It is listed at Hyderabad only.','5','programmes','Thermal, Hyderabad'),
('campus-pharmchem','Where is M.Pharm. Pharmaceutical Chemistry offered?','Which campus offers Pharmaceutical Chemistry?','It is listed at Pilani only.','5','programmes','Pharmaceutical Chemistry'),
('test-gate','How are most HD admissions made?','What are the two main HD admission routes?','For all M.E. except Software Systems and for M.Pharm., admission is based on the BITS HD test, GATE/GPAT score, or both according to the selected option.','5-6','admission-modes','BITS HD, GATE, GPAT'),
('software-test','How is M.E. Software Systems admission made?','Can GATE or GPAT determine Software Systems merit?','No. Software Systems admission is through the BITS HD test only; GATE/GPAT has no relevance to its merit ranking.','6-7','admission-modes','Software Systems, HD test'),
('gate-years','Which GATE years are considered?','How recent must a GATE score be?','The brochure says GATE 2025, 2024, or 2023 scores may be considered, provided the score is valid as stated on the scorecard.','6','eligibility','GATE 2023, 2024, 2025'),
('gpat-years','Which GPAT years are considered?','How recent must a GPAT score be?','The brochure says GPAT 2025, 2024, or 2023 scores may be considered, provided the score is valid.','6','eligibility','GPAT 2023, 2024, 2025'),
('three-options','What admission-basis options can an HD applicant choose?','Can a candidate choose GATE/GPAT, HD test, or both?','Yes. The application allows consideration only by GATE/GPAT, only by the BITS HD online test, or by both.','6','application','admission option'),
('merit-lists','How are HD merit lists prepared?','Are GATE/GPAT and HD-test merit lists separate?','Two separate merit lists are prepared for each programme: one based on GATE/GPAT and one based on BITS HD test marks.','6','merit','merit list'),
('seat-share','How are HD seats divided between routes?','What is the planned GATE/GPAT versus HD-test seat split?','Up to 50% of seats may be filled through GATE/GPAT and the other 50% through the BITS HD test; unfilled seats in one category may be allocated to the other.','6','merit','50%, seats'),
('cutoff','Who decides the HD cut-off?','How is the category cut-off determined?','The Admissions Committee considers cut-offs based on applications received and seats available; its final decision is binding.','6','merit','cut-off, committee'),
('gate-assistance','What assistance is available to GATE/GPAT admittees?','What financial support is described for GATE/GPAT students?','Eligible candidates may receive the AICTE/PCI GATE/GPAT scholarship, and the Institute lists a Rs. 13,400 per month tuition-fee waiver during the semester.','7','financial-assistance','GATE, GPAT, scholarship'),
('hd-stipend','What stipend is available through the BITS HD route?','How much is the HD-test-route stipend?','Candidates admitted through the BITS HD Test route are listed as eligible for a Rs. 13,400 per month stipend during the semester.','7','financial-assistance','stipend, 13400'),
('assistantship','What work is required for financial assistance?','Do scholarship or stipend recipients have teaching-assistant duties?','Recipients of a fee waiver or stipend must contribute 8-10 hours per week to graduate student teaching assistantship.','7','financial-assistance','assistantship'),
('gpat-pilani','Where does GPAT scholarship apply?','Is the GPAT scholarship available at every campus?','The brochure notes that GPAT scholarship is exclusively applicable to students admitted to the Pilani campus.','7','financial-assistance','GPAT, Pilani'),
('online-form','Where is the HD application submitted?','Is a hard copy of the HD application required?','The prescribed form is submitted online at bitsadmission.com/hd; a hard copy need not be sent, though applicants are advised to retain a printout.','7','application','online application'),
('preferences','Must HD applicants rank programme preferences?','What programme information is requested in the form?','Applicants must give preferences for the programmes they wish to apply for after checking programme-wise eligibility.','7','application','programme preferences'),
('centres','How many HD test-centre preferences are required?','What centre preference must a BITS HD test applicant provide?','Candidates writing the BITS HD test must give preferences for three test centres.','7','application','three test centres'),
('hd-fee-gate','What is the HD application fee for GATE/GPAT-only applicants?','How much is the fee for score-only consideration?','The listed fee is Rs. 1,000 for applicants seeking consideration through GATE/GPAT score only.','8','fees','application fee, GATE'),
('hd-fee-test','What is the HD application fee when the test is included?','How much do other HD applicants pay?','All other applicants are listed as paying Rs. 3,500, including the BITS HD online test fee.','8','fees','application fee, HD test'),
('nonrefund-hd','Is the HD application fee refundable?','Can the HD application fee be reclaimed?','No. The application fee is stated to be non-refundable.','8','fees','non-refundable'),
('hd-deadline','What was the HD application deadline?','When was the 2025-26 HD form due?','The brochure lists 19 April 2025 as the deadline for submitting the completed online application with the prescribed fee.','8','dates','19 April 2025'),
('hd-edit','Was an HD editing window provided?','When could HD applicants revise forms?','The listed online revision/editing dates were 21 and 22 April 2025, with changes restricted to certain aspects.','8-9','dates','editing, April 2025'),
('gate-iteration','When was the first GATE offer iteration listed?','What was the date for GATE Iteration 1 offers?','The brochure lists 28 April 2025 for announcement of admission offers based on GATE score, Iteration 1.','8','dates','GATE, iteration 1'),
('gate-payment','When was payment due for the first GATE offer?','What was the Iteration-1 GATE fee deadline?','The listed deadline for payment by candidates offered admission through GATE was 14 May 2025.','8','dates','GATE payment'),
('test-date','When was the BITS HD online test scheduled?','What test dates are listed for the HD exam?','The brochure lists 26 May or 1 June 2025 for the BITS HD online test.','8','dates','HD test date'),
('iteration2','When were Iteration-2 offers listed?','What was the Iteration-2 announcement date?','The listed announcement date for offers based on the HD test and GATE/GPAT was 12 June 2025.','8','dates','Iteration 2'),
('reporting','When were HD students expected to report?','What reporting date is listed for HD students?','The brochure lists 29 July 2025 for reporting of HD students.','8','dates','reporting'),
('orientation','When was HD orientation scheduled?','What date is listed for new-student orientation?','New-student orientation was listed for 31 July 2025.','8','dates','orientation'),
('coursework','When does HD coursework registration begin?','What coursework-registration date is listed?','Registration for coursework was listed for 1 August 2025.','8','dates','coursework'),
('classwork','When does HD classwork begin?','What class-start date is listed?','Classwork at the respective campuses was listed to begin on 2 August 2025.','8','dates','classwork'),
('one-form','Can an HD candidate submit multiple applications?','How many HD application forms may one candidate submit?','A candidate can submit only one Higher Degree admission application form.','9','application','one application'),
('paid-fees','Who is considered in later HD iterations?','Does failure to pay on time affect later iterations?','Only candidates who pay fees by the stated deadlines are considered for further iterations.','9','admission-process','fee deadline, iteration'),
('hd-contact','What email is listed for HD queries?','How can applicants contact HD admissions?','Queries may be directed to hdadmissions@pilani.bits-pilani.ac.in.','9','contact','HD admissions email'),
('biotech-eligibility','What prior background is required for M.E. Biotechnology?','Which degree background is accepted for HD Biotechnology?','An integrated first degree of BITS or equivalent with adequate preparation in biochemistry and microbiology is listed.','10-11','eligibility','Biotechnology'),
('cs-eligibility','What degree background is required for M.E. Computer Science?','Who is eligible for M.E. Computer Science?','An integrated first degree of BITS or equivalent in Computer Science or Information Technology is listed.','10-11','eligibility','Computer Science'),
('comm-eligibility','What degrees qualify for M.E. Communication Engineering?','Which prior disciplines are accepted for Communication Engineering?','The listed backgrounds are Electrical and Electronics, Electronics and Instrumentation, Electronics and Communication, or equivalent.','10-11','eligibility','Communication Engineering'),
('design-eligibility','Who is eligible for M.E. Design Engineering?','What prior degree is required for Design Engineering?','An integrated first degree in Mechanical or Manufacturing Engineering, or equivalent, is listed.','10','eligibility','Design Engineering'),
('embedded-eligibility','What degrees qualify for M.E. Embedded Systems?','Which backgrounds are accepted for Embedded Systems?','The listed backgrounds include Electrical and Electronics, Electronics and Instrumentation, Electronics and Communication, Computer Science, or equivalent.','10','eligibility','Embedded Systems'),
('micro-eligibility','Who can apply for M.E. Microelectronics?','What input degrees are listed for Microelectronics?','Electrical and Electronics, Electronics and Instrumentation, Electronics and Communication, Computer Science, Physics, or equivalent are listed.','10','eligibility','Microelectronics'),
('env-eligibility','What background is accepted for M.E. Environmental Engineering?','Which prior areas qualify for Environmental Engineering?','The brochure lists Biology, Civil, Chemical Engineering, and Chemistry; other M.Sc. or B.E. backgrounds with adequate preparation may also be considered.','10','eligibility','Environmental Engineering'),
('pharm-eligibility','What background is required for M.Pharm.?','Which prior degree qualifies for M.Pharm. specializations?','An integrated first degree of BITS in Pharmacy or equivalent is listed for the M.Pharm. specializations.','10','eligibility','M.Pharm., Pharmacy'),
('extra-courses','Can an equivalent BITS first-degree student need extra courses?','Can the HD duration exceed four semesters?','Students with a BITS integrated first degree or equivalent may be admitted to an M.E. with additional courses; in such cases the duration may exceed the normal duration and is decided case by case.','10','programme-structure','additional courses'),
('gate-papers','What GATE papers are listed for Biotechnology and Computer Science?','Which GATE paper codes are associated with these fields?','Biotechnology lists BT or Life Sciences XL; Computer Science lists Computer Science and Information Technology CS.','11','eligibility','GATE paper codes'),
('civil-paper','Which GATE paper is listed for Civil specializations?','What GATE code applies to Civil HD programmes?','Civil Engineering, code CE, is listed for the Civil specializations.','11','eligibility','Civil, GATE CE'),
('mechanical-papers','Which GATE papers are listed for Mechanical?','What GATE codes are listed for Mechanical HD programmes?','Mechanical Engineering ME and Production and Industrial Engineering PI are listed.','11','eligibility','Mechanical, GATE ME PI'),
('test1-math','What is in Core Mathematics Test 1?','Which mathematics areas are tested in HD Test 1?','The syllabus includes calculus, linear algebra, complex variables, probability and statistics, differential equations, and numerical methods.','18','syllabus','Core Mathematics'),
('calculus','Which calculus topics are listed for HD Test 1?','Does Core Mathematics include multivariable calculus?','Yes. It includes functions, limits, derivatives, definite integrals, series, partial derivatives, gradients, multiple integrals, line and surface integrals, and Green, Gauss, and Stokes theorems.','18','syllabus','calculus'),
('linear-algebra','What linear algebra is included in HD Test 1?','Which matrix and vector topics are listed?','The syllabus includes matrix algebra, row reduction, rank and inverse, linear systems, vector spaces, linear transformations, eigenvalues, and eigenvectors.','18','syllabus','linear algebra'),
('probability','What probability topics are included?','Does the HD mathematics syllabus include distributions and inference?','It includes conditional probability, random variables, common distributions, expectation, variance, limit theorems, sampling distributions, estimation, hypothesis tests, correlation, and regression.','18','syllabus','probability, statistics'),
('english','What English skills are tested in HD admissions?','Which English-language areas are listed for the HD test?','The English syllabus covers grammar, vocabulary, reading comprehension, and composition.','19','syllabus','English'),
('logical','What logical-reasoning skills are tested in HD admissions?','Which reasoning tasks appear in the HD syllabus?','Verbal tasks include analogy, classification, series completion, passage deduction, and chart logic; nonverbal tasks include patterns, figure analysis, paper cutting, figure matrices, and rule detection.','19-20','syllabus','logical reasoning'),
('chemical-test','What subjects are in the Chemical Engineering special test?','Which Chemical Engineering areas are listed?','The syllabus includes process calculations, fluid mechanics, thermodynamics, mass transfer, heat transfer, mechanical operations, reaction engineering, process technology, plant design and economics, and process dynamics and control.','21-23','syllabus','Chemical Engineering'),
('civil-test','What subjects are in the Civil Engineering special test?','Which Civil Engineering areas are listed?','The syllabus includes mechanics and strength, structural analysis, concrete and steel design, transportation, surveying, construction planning and technology, and related civil topics.','23-25','syllabus','Civil Engineering'),
('software-test-syllabus','What is in the Software Systems special-test syllabus?','Which computer topics are listed for Software Systems?','It covers C programming, advanced C, object orientation and software engineering, database systems, and core systems including operating systems, networking, and web systems.','53','syllabus','Software Systems'),
('c-programming','What C topics are listed for Software Systems?','Does the Software Systems syllabus include pointers and linked lists?','Yes. It includes control constructs, functions and variables, recursion, dynamic memory allocation, pointers, address arithmetic, dynamically allocated data, and linked lists.','53','syllabus','C, pointers, linked lists'),
('databases','What database topics are listed for Software Systems?','Is SQL included in the HD Software Systems syllabus?','Yes. Database modeling and design, ER modeling, normalization techniques, and SQL querying are listed.','53','syllabus','database, SQL'),
('core-systems','What core-systems subjects are listed?','Does Software Systems include networking and operating systems?','Yes. The syllabus includes number representation, Boolean algebra, logic gates, circuits, computer organization, operating systems, memory, storage, file systems, LANs, Ethernet, TCP/UDP/IP, HTTP, HTML, XML, and client-server systems.','53','syllabus','operating systems, networking'),
('environmental-test','What is in the Environmental Engineering special test?','Which environmental topics are listed?','The syllabus covers pollution, water and wastewater treatment, water-quality measurement, sludge treatment and disposal, and solid-waste management.','52','syllabus','Environmental Engineering'),
('physics-test','What areas are listed for the Physics special test?','Which advanced Physics domains are included?','The list includes modern physics, thermodynamics and properties of matter, classical mechanics, electromagnetic theory, quantum mechanics, mathematical methods, statistical physics, solid-state physics, optics and spectroscopy, and nuclear and particle physics.','49-51','syllabus','Physics, HD test'),
('math-advanced','What advanced mathematics areas are listed?','Which higher mathematics topics appear in the HD syllabus?','The brochure lists optimization, discrete mathematics, real analysis, algebra, mathematical methods, operations research, graphs and networks, measure and integration, topology, differential equations, numerical analysis, functional analysis, differential geometry, and partial differential equations.','47-49','syllabus','advanced mathematics'),
('question-bank','Do all HD candidates receive the same test questions?','How are HD online test question sets generated?','Tests are generated from a large question bank, so candidates receive different sets; an expert committee aims for comparable difficulty, content, and question types.','16-17','test-rules','question bank'),
('computer-skill','What computer skills are assumed for the HD test?','Must HD candidates know basic keyboard and mouse operation?','Yes. The test assumes basic computer familiarity, and candidates are responsible for acquiring those skills before the test.','16-17','test-rules','computer skills'),
('centre-change','Can the Institute cancel a test centre?','What happens if an HD test centre is cancelled?','The Institute may cancel a centre and accommodate affected candidates at alternate centres, including Pilani, Goa, or Hyderabad.','17','test-centres','centre cancellation'),
('scorecard','What must GATE/GPAT applicants upload?','Is a self-attested scorecard required?','Applicants using the GATE/GPAT route must upload a self-attested scanned GATE/GPAT scorecard while applying online.','17','documents','scorecard'),
]

cross = [
('cycle','Which brochure should answer 2026-27 undergraduate dates?','Where should a chatbot look for current BITSAT undergraduate dates?','Use the BITSAT-2026 brochure for 2026-27 undergraduate dates. The FD modality document contains older 2022 material and should not override the current BITSAT brochure.','BITSAT pages 2,10; FD pages 1,7','cross-document','cycle, dates'),
('hd-cycle','Which document should answer 2025-26 Higher Degree dates?','Where are current HD dates in this document set?','Use the Higher Degree brochure for 2025-26. The BITSAT brochure covers undergraduate admissions, while the FD document is older and general.','HD page 8; BITSAT page 2; FD page 1','cross-document','HD, dates'),
('undergrad-vs-hd','What is the difference between BITSAT and BITS HD?','Which exam applies to undergraduate versus Higher Degree admission?','BITSAT-2026 is for Integrated First Degree programmes; BITS HD is the online test used for the 2025-26 M.E./M.Pharm. Higher Degree process, except that some candidates may use GATE/GPAT.','BITSAT pages 2,7; HD pages 5-7','comparison','BITSAT, BITS HD'),
('fee-warning','Can fees from the FD document be quoted as current?','How should the chatbot handle the FD fee tables?','No. The FD fee tables are explicitly associated with the 2022-23 material. The chatbot should label them historical and direct users to the official current fee notice.','FD pages 25-35','data-quality','historical fees'),
('official-site','What official site should users check?','Where should admissions information be verified?','The brochures direct applicants to the official BITS admissions website, including admissions.bits-pilani.ac.in; HD applications are referenced at bitsadmission.com/hd.','BITSAT pages 10-16; HD pages 7-9','contact','official website'),
('merit-comparison','How are undergraduate and HD merit lists different?','What score creates merit in BITSAT versus HD admission?','BITSAT undergraduate merit is based on BITSAT-2026 score after eligibility checks; HD admissions use separate GATE/GPAT and BITS HD test merit lists.','BITSAT page 8; HD page 6','comparison','merit lists'),
('application-separate','Does taking the entrance test complete admission?','Are test registration and admission application separate?','No. BITSAT candidates must separately submit the FD admission form with 12th marks and preferences; HD applicants submit the prescribed HD application and choose programme/test options.','BITSAT pages 10-11; HD pages 7-9','application','admission application'),
('negative-marking','Which tests in the set use negative marking?','Is negative marking specified for BITSAT and HD?','BITSAT explicitly awards +3 for correct and -1 for incorrect answers. The HD brochure describes its test structure and syllabi but does not state the same marking scheme in the cited sections.','BITSAT page 7; HD pages 16-20','comparison','negative marking'),
('scholarship-comparison','Are undergraduate and HD financial aids the same?','How do FD scholarships differ from HD assistance?','The FD document lists tuition-fee waivers and merit/need awards; the HD brochure lists GATE/GPAT scholarship or fee waiver and a BITS HD-route stipend, with teaching-assistant work.','FD pages 33-35; HD page 7','comparison','scholarship, stipend'),
('campuses','Which campuses appear across the documents?','What BITS campuses are relevant to these admissions?','The undergraduate BITSAT and FD material focus on Pilani, K K Birla Goa, and Hyderabad; the HD brochure also uses those three campuses for its listed on-campus programmes.','BITSAT page 2; FD page 7; HD page 5','campuses','Pilani, Goa, Hyderabad'),
('programme-level','Can a BITSAT applicant apply to M.E. programmes?','Does BITSAT cover Higher Degree programmes?','No. BITSAT-2026 covers Integrated First Degree programmes. M.E. and M.Pharm. Higher Degree admission is described separately in the HD brochure.','BITSAT page 2; HD page 5','comparison','programme level'),
('board-topper-vs-test','Can a board topper be admitted without a BITSAT score?','How does board-topper admission differ from the BITSAT route?','The BITSAT-2026 brochure states that eligible first-rank Central and State board students may receive direct admission irrespective of BITSAT score; ordinary applicants use BITSAT merit.','BITSAT pages 3,8','comparison','board topper'),
('document-verification','What happens if submitted admission information is false?','Can BITS verify submitted marks and documents?','Yes. The brochures reserve the right to verify information and take action, including cancellation of candidature/admission and legal proceedings for discrepancies or misrepresentation.','BITSAT pages 10-11,15; HD page 17','conduct','document verification'),
('question-language','Are the undergraduate and HD tests both in English?','What language is specified?','BITSAT questions and instructions are in English. The HD English syllabus assesses English proficiency, but the HD brochure should be consulted for any test-language detail not stated explicitly.','BITSAT pages 7-8; HD pages 19-20','comparison','English'),
('test-centre','How are test centres handled in BITSAT and HD?','Do both tests use centre preferences?','BITSAT asks Indian applicants for three city preferences and allocates a centre; HD applicants writing the HD test are asked for three test-centre preferences.','BITSAT page 9; HD page 7','comparison','test centres'),
('results-delayed','How should delayed school results be handled?','What is the difference between BITSAT result submission and HD scorecards?','BITSAT has a specific later-upload process for delayed Class XII results. HD GATE/GPAT applicants must upload a self-attested scorecard, so the relevant document rule depends on the admission route.','BITSAT pages 10-11; HD page 17','documents','delayed result, scorecard'),
('current-answer','How should the chatbot answer if a date or fee may have changed?','What response policy is safest for time-sensitive admissions questions?','State the date and source cycle from the brochure, mark it as tentative or historical where applicable, and direct the user to the official admissions website for the latest notice.','All documents','chatbot-policy','dates, fees, verification'),
('source-attribution','Should each FAQ answer identify its source?','How should chatbot records preserve provenance?','Yes. Store the source document and page range with each answer so the system can cite or retrieve the supporting passage and distinguish 2026-27, 2025-26, and 2022-23 information.','All documents','chatbot-design','source, provenance'),
('intent','How should similar applicant questions be grouped?','What FAQ categories are useful for retrieval?','Useful categories include eligibility, programmes, application, fees, dates, test format, centres, merit, waitlist, scholarships, documents, conduct, contacts, and syllabus.','All documents','chatbot-design','intent, categories'),
('fallback','What should the chatbot do when a question is not answered by the PDFs?','How should unsupported questions be handled?','It should say that the answer is not present in the supplied brochures, avoid guessing, and point the user to the official admissions website or the relevant admissions office.','All documents','chatbot-policy','fallback, unsupported'),
('conflict','What if two brochures give different rules?','How should conflicting source content be resolved?','Prefer the document for the requested programme and admission year; if years differ, explain the discrepancy and use the newer official cycle for current guidance.','All documents','chatbot-policy','conflict, source priority'),
('fees-context','How should a fee answer be phrased?','What context must accompany a fee figure?','Include the admission route, campus or centre where relevant, currency, academic cycle, and whether the amount is one-time, semester-based, refundable, or historical.','FD pages 25-35; BITSAT page 6; HD page 8','chatbot-design','fees, context'),
('date-context','How should an admission deadline be phrased?','What should accompany a deadline in the chatbot?','Include the exact date, the relevant session or programme, the brochure year, and a note that tentative dates may change through the official website.','BITSAT page 10; HD page 8','chatbot-design','dates, context'),
('answer-length','How long should FAQ answers be?','What answer style is efficient for a chatbot?','Use a direct answer first, keep supporting conditions in one or two sentences, and attach source metadata separately for retrieval and citation.','All documents','chatbot-design','answer style'),
('privacy','What personal-data caution appears in BITSAT instructions?','What should applicants do about privacy and personal data?','BITSAT applicants must review and acknowledge the personal-data consent and privacy policy before registering.','BITSAT page 11','application','privacy, consent'),
('conduct','What common conduct rule applies across the material?','How should applicants treat exam and campus rules?','Applicants and students must follow the Institute’s instructions and rules; violations can lead to disqualification, disciplinary action, forfeiture, expulsion, or legal action depending on the breach.','BITSAT pages 8,15; FD pages 37-38; HD page 17','conduct','rules, discipline'),
('campus-choice','Can a candidate freely change programme or campus preferences later?','Are preference changes unrestricted?','No. BITSAT and FD materials restrict changes after the relevant deadlines, with only specified editing windows. HD applicants also have limited form-editing opportunities.','BITSAT pages 6,13; FD pages 6-7; HD page 9','application','preferences, editing'),
('higher-preference','What does “higher preference” mean?','How is higher-preference movement used?','It means a programme ranked above the candidate’s current offer in the submitted preference order; later iterations may move a candidate to such a choice if a seat becomes available.','FD pages 5-7; BITSAT page 8','admission-process','higher preference, iteration'),
('institution','How is BITS Pilani described in the HD brochure?','What institutional description is provided?','The HD brochure describes BITS Pilani as a Deemed to be University with on-campus programmes across Pilani, Goa, Hyderabad, Mumbai, and Dubai, and as an Institute of Eminence.','HD page 4','institution','Institute of Eminence'),
('research','What research information is highlighted in the HD brochure?','What research indicators are mentioned?','The brochure highlights external research funding, faculty and student research, patents, and BITSian founders as institutional context. These figures are brochure-specific and should not be treated as live statistics without verification.','HD page 4','institution','research, patents'),
('campus-international','Does the FD document describe international admissions?','What international route is included?','Yes. It includes an International Student Admission Scheme with separate eligibility, fee, scholarship, and related information.','FD pages 12,28-35','international','ISA'),
('international-fees','Should international fee figures be used for domestic applicants?','Who do the ISA fee tables apply to?','They apply to students admitted through the International Student Admission Scheme, with separate non-SAARC and SAARC figures; they should not be used for domestic applicants.','FD pages 28-32','international-fees','SAARC, non-SAARC'),
('programme-codes','Are programme codes provided in the FD document?','Can the chatbot answer a historical programme-code question?','Yes. The document includes historical First Degree programme codes such as A1 for Chemical, A2 for Civil, A7 for Computer Science, and B1-B5 for several M.Sc. programmes.','FD pages 36-37','student-records','programme codes'),
('contact-routing','How should the chatbot route contact questions?','Which contact type should be separated?','Route BITSAT payment problems to the payment email, other BITSAT questions to the general BITSAT email, and HD questions to the HD admissions email.','BITSAT page 16; HD page 9','contact','routing, email'),
('final-authority','Who has final authority in exam matters?','Which authority’s decision is final?','The BITSAT brochure says the Vice-Chancellor’s decision is final for BITSAT matters; the HD brochure similarly states that the Vice-Chancellor’s decision is final for the HD test.','BITSAT page 14; HD page 17','policy','final authority'),
]

def topic_facts(prefix, topics, pages, category, source_label):
    out = []
    for name, detail in topics:
        out.append((
            f'{prefix}: {name}',
            f'Does the {source_label} document include {name}?',
            f'What does the {source_label} document say about {name}?',
            detail,
            pages,
            category,
            name
        ))
    return out

bitsat_topics = [
('units and measurement','The Physics syllabus includes units, SI units, dimensional analysis, precision, significant figures, and fundamental measuring instruments.'),
('vectors and kinematics','The Physics syllabus includes vector properties, position, velocity, acceleration, constant-acceleration motion, projectiles, circular motion, and relative motion.'),
('Newton laws','The Physics syllabus includes Newton’s laws, free-body diagrams, inclined planes, pulley systems, centripetal force, and inertial and non-inertial frames.'),
('impulse and momentum','The Physics syllabus includes impulse, momentum, conservation of momentum, collisions, centre of mass, and systems of particles.'),
('work and energy','The Physics syllabus includes work, kinetic energy, the work-energy theorem, power, conservative forces, potential energy, and mechanical-energy conservation.'),
('rotational motion','The Physics syllabus includes angular motion, moment of inertia, parallel and perpendicular axes, torque, angular momentum, and rolling motion.'),
('gravitation','The Physics syllabus includes Newton’s law of gravitation, gravitational potential energy, escape velocity, Kepler’s laws, and satellite motion.'),
('solids and fluids','The Physics syllabus includes elasticity, pressure, density, Archimedes’ principle, viscosity, surface tension, and Bernoulli’s theorem.'),
('oscillations','The Physics syllabus includes simple harmonic motion, spring-mass systems, pendulums, forced and damped oscillations, and resonance.'),
('waves','The Physics syllabus includes progressive waves, standing waves in strings and pipes, superposition, beats, and the Doppler effect.'),
('heat and thermodynamics','The Physics syllabus includes kinetic theory, thermal equilibrium, heat transfer, thermal conductivity, Newton’s law of cooling, the first and second laws, and Carnot engines.'),
('electrostatics','The Physics syllabus includes Coulomb’s law, electric fields and potential, Gauss’ law, electric dipoles, capacitance, and dielectrics.'),
('current electricity','The Physics syllabus includes Ohm’s law, Joule heating, DC circuits, Kirchhoff’s laws, potentiometers, Wheatstone bridges, resistivity, and temperature dependence.'),
('magnetic effects','The Physics syllabus includes Biot-Savart law, Ampere’s law, Lorentz force, current-carrying conductors, magnetic moments, galvanometers, and meter conversion.'),
('electromagnetic induction','The Physics syllabus includes Faraday’s law, Lenz’s law, eddy currents, inductance, transformers, generators, AC values, and LCR circuits.'),
('optics','The Physics syllabus includes reflection, refraction, lenses, mirrors, telescopes, microscopes, interference, diffraction, electromagnetic waves, and polarization.'),
('modern physics','The Physics syllabus includes the photoelectric effect, de Broglie wavelength, atomic models, hydrogen spectra, radioactivity, fission, fusion, and binding energy.'),
('electronic devices','The Physics syllabus includes semiconductors, diodes, rectifiers, LEDs, photodiodes, solar cells, Zener regulators, transistors, amplifiers, oscillators, and logic gates.'),
('chemical measurement','The Chemistry syllabus includes physical quantities, SI units, dimensional analysis, precision, and significant figures.'),
('mole concept','The Chemistry syllabus includes laws of chemical combination, atomic and molar masses, percentage composition, empirical and molecular formulae, equations, and stoichiometry.'),
('gaseous state','The Chemistry syllabus includes kinetic theory, gas laws, the ideal gas equation, Avogadro number, critical temperature, liquefaction, and van der Waals equation.'),
('liquid and solid states','The Chemistry syllabus includes vapour pressure, surface tension, viscosity, crystal systems, unit cells, close packing, ionic crystals, diamond, and graphite.'),
('chemical thermodynamics','The Chemistry syllabus includes thermochemistry, enthalpy, Hess law, entropy, Gibbs energy, spontaneity, and equilibrium-related concepts.'),
('chemical kinetics','The Chemistry syllabus includes reaction rates, rate laws, order and molecularity, integrated rate equations, activation energy, and catalysis.'),
('electrochemistry','The Chemistry syllabus includes conductance, electrolysis, galvanic cells, electrode potentials, the Nernst equation, batteries, and corrosion.'),
('organic chemistry basics','The Chemistry syllabus includes structural representation, isomerism, nomenclature, electronic effects, reaction intermediates, and basic organic reaction types.'),
('polymers and biomolecules','The Chemistry syllabus includes polymers, carbohydrates, amino acids, proteins, nucleic acids, vitamins, and chemistry in everyday life.'),
('English grammar','BITSAT English covers determiners, prepositions, modals, adjectives, agreement, tense, parallel construction, voice, transformations, question tags, and relative clauses.'),
('English vocabulary','BITSAT English covers odd words, one-word substitutions, spelling and word formation, homophones, contextual meanings, synonyms, antonyms, collocations, phrasal verbs, idioms, and analogy.'),
('reading comprehension','BITSAT reading comprehension covers main ideas, conclusions using evidence, anticipating ideas, facts versus opinions, figurative vocabulary, summaries, referents, and reorganization of information.'),
('composition','BITSAT composition covers word order, logical paragraph organization, topic sentences, paragraph unity, and linkers or connectives.'),
('verbal reasoning','BITSAT verbal reasoning covers analogy, classification, series completion, logical deduction from passages, and chart logic.'),
('nonverbal reasoning','BITSAT nonverbal reasoning covers pattern perception, figure formation and analysis, paper cutting, figure matrices, and rule detection.'),
('Mathematics algebra','BITSAT Mathematics includes complex numbers, quadratic equations, progressions, logarithms, exponentials, permutations, combinations, binomial theorem, matrices, determinants, sets, relations, functions, reasoning, and inequalities.'),
('Mathematics trigonometry','BITSAT Mathematics includes angles in radians and degrees, trigonometric ratios and functions, graphs, identities, equations, and inverse trigonometric functions.'),
('coordinate geometry','BITSAT Mathematics includes two-dimensional lines, circles, conics, three-dimensional lines and planes, direction ratios, shortest distances, coplanarity, and angles.'),
('differential calculus','BITSAT Mathematics includes domains and ranges, limits, continuity, differentiability, derivatives, chain rule, tangents, normals, monotonicity, extrema, and standard theorems.'),
('integral calculus','BITSAT Mathematics includes indefinite and definite integration, substitution, parts, partial fractions, trigonometric identities, the fundamental theorem, and areas bounded by curves.'),
('probability and statistics','BITSAT Mathematics includes probability rules, conditional probability, Bayes theorem, independent events, random variables, distributions, variance, dispersion, and frequency distributions.'),
('vectors and linear programming','BITSAT Mathematics includes vector products and projections, scalar triple products, formulation and graphical solution of linear programmes, and mathematical modelling.'),
('biology diversity','BITSAT Biology includes taxonomy, systematics, binomial nomenclature, classification of organisms, plant groups, and animal groups.'),
('cell biology','BITSAT Biology includes cell structures, prokaryotic and eukaryotic differences, plant and animal cells, cell cycle, mitosis, meiosis, biomolecules, and enzymes.'),
('genetics','BITSAT Biology includes Mendelian inheritance, chromosome theory, gene interactions, dominance patterns, linkage, crossing over, DNA organization and replication, transcription, translation, and evolution.'),
('plant physiology','BITSAT Biology includes plant morphology, tissues, water and nutrient movement, transpiration, mineral nutrition, nitrogen fixation, photosynthesis, respiration, and energy relations.'),
('human physiology','BITSAT Biology includes digestion, respiration, circulation, blood and lymph, kidney function, locomotion, nervous coordination, sensory reception, endocrine glands, and hormones.'),
('plant reproduction','BITSAT Biology includes asexual and sexual reproduction, gametophytes, pollination, fertilization, embryo and seed development, growth regulators, dormancy, senescence, and photoperiodism.'),
('human reproduction','BITSAT Biology includes reproductive systems, menstrual cycle, gamete production, fertilization, implantation, embryo development, pregnancy, parturition, and contraception.'),
('ecology','BITSAT Biology includes ecology, habitats, niches, levels of organization, ecosystems, succession, food chains, energy flow, biodiversity, pollution, climate change, ozone depletion, and conservation.'),
('human welfare','BITSAT Biology includes animal husbandry, communicable pathogens, disease control, cancer, AIDS, substance abuse, immunology, plant breeding, and tissue culture.'),
('biotechnology','BITSAT Biology includes microbial biotechnology, food and industrial processing, sewage treatment, recombinant DNA, vectors, insulin, vaccines, gene therapy, GM crops, and Bt crops.'),
('online registration','The sample application screens require personal-data consent, registration, captcha, OTP validation, identity details, photograph and signature upload, city preference, and online fee payment.'),
('mobile validation','Indian mobile numbers use country code +91 for OTP; for an international mobile number, the OTP is sent through email for validation.'),
('payment methods','The sample application instructions mention Internet Banking, debit card, credit card, and UPI as online payment facilities.'),
('application preview','The application flow includes entering a captcha, previewing the form, accepting declarations, and submitting the form with payment.'),
('test-city form','The application form includes selection of test-city preferences before saving and proceeding.'),
('identity proof','The sample application requires selecting an ID-proof document and entering its identification number.'),
]

fd_topics = [
('admission fee','The historical domestic FD fee table lists an admission fee of Rs. 50,900 at Pilani, Goa, and Hyderabad.'),
('domestic tuition','For students admitted in 2022-23, the domestic table lists Rs. 2,31,500 for each first and second semester.'),
('domestic summer fee','For the cited 2022-23 domestic cohort, the summer-term fee is listed as Rs. 81,000.'),
('Students Union fee','The domestic table lists a Students’ Union fee of Rs. 450 per annum.'),
('Students Aid Fund','The domestic table lists a Students’ Aid Fund contribution of Rs. 225 per annum.'),
('Pilani hostel fee','For on-campus students in the cited table, Pilani hostel fees are Rs. 17,100 for each first and second semester and Rs. 8,550 for summer.'),
('Goa hostel fee','For on-campus students in the cited table, Goa hostel fees are Rs. 22,950 for each first and second semester and Rs. 11,475 for summer.'),
('Hyderabad hostel fee','For on-campus students in the cited table, Hyderabad hostel fees are Rs. 22,950 for each first and second semester and Rs. 11,475 for summer.'),
('mess advance','The domestic table lists mess and electricity advances of Rs. 10,000 for each semester and Rs. 5,000 for summer, adjustable at the end.'),
('other advance','The domestic table lists other advances of Rs. 12,000 for the first and second semesters.'),
('caution deposit','The domestic table lists an Institute caution deposit of Rs. 3,000 at each of the three Indian campuses.'),
('annual tuition escalation','The cited domestic tuition table rises from Rs. 2,31,500 in AY 2022-23 to Rs. 2,80,500 in AY 2026-27 for that cohort.'),
('annual summer escalation','The cited domestic summer-term table rises from Rs. 81,000 in AY 2022-23 to Rs. 98,100 in AY 2026-27 for that cohort.'),
('summer percentage','The document says the summer-term tuition fee is about 35% of the corresponding academic-year semester tuition fee.'),
('PhD tuition','The document states that full-time and part-time PhD semester tuition is 10% and 20%, respectively, of the listed amount.'),
('mess dues','Students must clear mess dues monthly; accumulated mess arrears may require an additional advance at next registration.'),
('grade withholding','Grades may be withheld when a student has outstanding dues.'),
('FD aid coverage','The historical scholarship section says about 30% of FD students receive some financial assistance and lists waivers from 15% to 100%.'),
('merit top one','The historical Institute merit award gives the top 1% a 100% total tuition-fee waiver.'),
('merit top two','The historical Institute merit award gives the next listed top 2% band a 40% total tuition-fee waiver.'),
('need three','The historical merit-cum-need table lists 80% tuition waiver for 3% of students.'),
('need six','The historical merit-cum-need table lists 40% tuition waiver for 6% of students.'),
('need twelve','The historical merit-cum-need table lists 25% tuition waiver for 12% of students.'),
('need six lower','The historical merit-cum-need table lists 15% tuition waiver for another 6% of students.'),
('government scholarships','The document lists Government of India and State Government scholarships among possible assistance sources.'),
('SC ST scholarships','The document lists Government of India scholarships for Scheduled Caste and Scheduled Tribe students.'),
('teacher-child scholarships','The document lists national scholarships for children of primary and secondary school teachers.'),
('charitable trusts','Scholarships from various charitable trusts are listed as a possible assistance source.'),
('Students Aid Fund assistance','Financial assistance from the Students Aid Fund is listed separately from fee-waiver awards.'),
('MNES fellowships','The document mentions two research fellowships sanctioned by MNES for advanced renewable-energy study.'),
('Alumni travel fellowship','BITS and BITSAA International Travel Fellowship support is described as 75% of travel cost for selected international conference papers.'),
('ISA application fee','The historical ISA table lists an application fee of Rs. 6,750 for non-SAARC and SAARC students.'),
('ISA admission fee','The historical ISA table lists a one-time admission fee of Rs. 1,23,800 for both non-SAARC and SAARC students.'),
('ISA facilitation fee','The historical ISA table lists a Rs. 16,130 facilitation fee for local travel, room, and board during first-month orientation.'),
('ISA caution','The historical ISA table lists a Rs. 32,000 refundable caution deposit.'),
('ISA annual fee','The historical ISA table lists Rs. 4,160 for Students’ Union and Student Aid Fund together.'),
('ISA non-SAARC tuition','The historical ISA table lists Rs. 5,88,500 per semester for non-SAARC students in AY 2022-23.'),
('ISA SAARC tuition','The historical ISA table lists Rs. 3,47,250 per semester for SAARC students in AY 2022-23.'),
('ISA hostel','The historical ISA table lists Rs. 48,650 per semester for hostel fees and internet charges for both groups.'),
('ISA mess','The historical ISA table lists Rs. 10,000 per semester as mess and electricity advance for both groups.'),
('ISA other advance','The historical ISA admission table lists other advances of Rs. 12,000 per semester.'),
('ISA total','The historical first-semester total is listed as Rs. 8,35,240 for non-SAARC and Rs. 5,93,990 for SAARC students.'),
('ISA summer tuition','The historical ISA table lists summer tuition at about 35% of the corresponding semester tuition.'),
('ISA summer hostel','The historical ISA table lists summer hostel fees at 50% of the corresponding semester hostel fees.'),
('ISA Practice School','The historical ISA table lists Practice School I and II fees at 35% of corresponding semester tuition.'),
('ISA minor fee','The historical ISA table lists a Minor Certificate Fee of 6% of semester tuition.'),
('ISA placement charge','The historical ISA table lists placement charges of 3% of semester tuition.'),
('ISA fee escalation','For the 2022-23 ISA cohort, the document says tuition increases by 5% each year in INR after the entry year.'),
('ISA scholarship top four','The historical ISA scholarship policy gives an 80% tuition waiver to the top 4%.'),
('ISA scholarship next ten','The historical ISA scholarship policy gives a 50% tuition waiver to the next 10%.'),
('ISA scholarship next twenty','The historical ISA scholarship policy gives a 30% tuition waiver to the next 20%.'),
('ISA scholarship remaining','The historical ISA scholarship policy gives a 15% tuition waiver to the remaining students.'),
('ISA grade condition','For continuing ISA scholarship eligibility, the document says a student should not have more than one E grade or one NC report in the previous semester.'),
('record withholding','The grade sheet may be withheld for unpaid dues or a pending discipline or unfair-means case.'),
('provisional certificate','A provisional certificate and refund of positive balance and caution money are issued with the transcript, subject to no pending matters.'),
('ID programme code','The student ID includes programme code, admission year, Practice School or Thesis stream, and campus information.'),
('HD ID stream','Higher Degree IDs indicate whether the student is in the Practice School stream K1 or Dissertation stream H1.'),
('Chemical code','The historical programme-code table gives A1 to B.E. Chemical.'),
('Civil code','The historical programme-code table gives A2 to B.E. Civil.'),
('Computer Science code','The historical programme-code table gives A7 to B.E. Computer Science.'),
('MSc codes','The historical programme-code table gives B1-B5 to Biological Sciences, Chemistry, Economics, Mathematics, and Physics.'),
('Dubai separate forms','Dubai admissions use separate forms for First Degree, Higher Degree, and Doctoral programmes.'),
('Dubai qualification','Dubai admissions are open to recognized international-board qualifications from all countries.'),
('Dubai residence visa','For students admitted from countries other than UAE, a student residence visa is facilitated.'),
('international fee currency','ISA students are expected to pay in INR; any USD payment uses the conversion rate on the payment day.'),
('special fee authority','For specific programmes requiring special treatment, the Vice-Chancellor may determine fees and payment mode with the Chancellor.'),
('anti-ragging undertaking','All students must sign an undertaking to follow anti-ragging guidelines.'),
('anti-ragging penalties','Violating anti-ragging guidelines may lead to disciplinary action, expulsion, and possible legal action.'),
]

hd_topics = [
('calculus','Core Mathematics Test 1 includes functions, limits, continuity, derivatives, definite integrals, infinite series, multivariable calculus, partial derivatives, gradients, extrema, multiple integrals, and vector-calculus theorems.'),
('linear algebra','Core Mathematics includes matrix algebra, row reduction, rank, inverses, linear systems, vector spaces, linear transformations, eigenvalues, and eigenvectors.'),
('complex variables','Core Mathematics includes analytic functions, Cauchy theorems and integral formula, Taylor and Laurent series, residues, and applications.'),
('probability statistics','Core Mathematics includes conditional probability, random variables, distributions, expectation, variance, sampling, estimation, hypothesis tests, correlation, and regression.'),
('differential equations','Core Mathematics includes first- and higher-order equations, variation of parameters, Cauchy-Euler equations, Fourier series, Laplace transforms, and boundary-value problems.'),
('numerical methods','Core Mathematics includes Newton, secant, fixed-point, false-position, linear-system, LU, trapezoidal, and Simpson methods.'),
('English grammar','HD English includes agreement, tense, parallel construction, relative pronouns, determiners, prepositions, modals, adjectives, voice, transformation, question tags, and phrasal verbs.'),
('English vocabulary','HD English includes synonyms, antonyms, odd words, one-word substitutions, jumbled letters, homophones, spelling, contextual meanings, and analogy.'),
('English comprehension','HD English reading comprehension includes content, vocabulary, referents, idioms or phrases, and rewording.'),
('English composition','HD English composition includes rearrangement, paragraph unity, and linkers or connectives.'),
('verbal analogy','HD verbal reasoning includes analogy questions based on identifying corresponding relationships.'),
('classification','HD verbal reasoning includes classification questions that identify the odd item using a common quality.'),
('series completion','HD verbal reasoning includes completing number or letter series or identifying an incorrect part.'),
('logical deduction','HD verbal reasoning includes drawing correct or incorrect conclusions from a passage.'),
('chart logic','HD verbal reasoning includes completing a partially filled chart or table from given information.'),
('pattern perception','HD nonverbal reasoning includes identifying a missing quarter in a visual pattern.'),
('figure formation','HD nonverbal reasoning includes forming or analysing figures from given parts.'),
('paper cutting','HD nonverbal reasoning includes analysing patterns made by cutting folded paper.'),
('figure matrix','HD nonverbal reasoning includes identifying a missing figure in a matrix governed by a common rule.'),
('rule detection','HD nonverbal reasoning includes selecting figures that obey a specified rule and form a series.'),
('chemical process calculations','Chemical Engineering Test 2 includes units, dimensions, stoichiometry, thermodynamic properties, mass and energy balances, phase equilibria, recycle, bypass, purge, and combustion.'),
('fluid mechanics','Chemical Engineering Test 2 includes fluid statics, Newtonian and non-Newtonian fluids, head loss, pressure drop, flow, packed beds, dimensional analysis, meters, pumps, and compressors.'),
('chemical thermodynamics','Chemical Engineering Test 2 includes the first and second laws, entropy, equations of state, mixtures, fugacity, activity coefficients, phase equilibria, and reaction equilibrium.'),
('mass transfer','Chemical Engineering Test 2 includes diffusion, mass-transfer coefficients, interphase transfer, distillation, absorption, adsorption, leaching, extraction, drying, humidification, and crystallization.'),
('heat transfer','Chemical Engineering Test 2 includes steady and unsteady conduction, natural and forced convection, radiation, condensation, boiling, evaporation, and heat exchangers.'),
('mechanical operations','Chemical Engineering Test 2 includes particulate solids, mechanical separation, size distribution, size reduction, centrifuges, cyclones, filtration, agitation, and mixing.'),
('reaction engineering','Chemical Engineering Test 2 includes mole balances, reactor sizing, rate laws, stoichiometry, isothermal and non-isothermal design, heterogeneous and non-ideal reactors.'),
('process technology','Chemical Engineering Test 2 includes sulphuric and phosphoric acid, fertilizers, pulp and paper, sugar, oils and fats, petroleum, petrochemicals, polymers, PVC, and synthetic fibres.'),
('plant economics','Chemical Engineering Test 2 includes process economics, depreciation, cost indices, return, payback, discounted cash flow, optimization, evaporators, heat exchangers, and contactors.'),
('process control','Chemical Engineering Test 2 includes dynamic modelling, Laplace transforms, transfer functions, feedback controllers, P/PI/PID tuning, advanced control, sensors, and transducers.'),
('mechanics of materials','Civil Engineering Test 2 includes mechanics, deformable bodies, forces and moments, stress and strain, bending, and torsion.'),
('structural analysis','Civil Engineering Test 2 includes determinate and indeterminate trusses, beams, frames, cables, arches, deflections, influence lines, and matrix methods.'),
('concrete design','Civil Engineering Test 2 includes reinforced-concrete ingredients, mix design, working-stress and limit-state design, bond, anchorage, shear, slabs, stairs, and columns.'),
('steel design','Civil Engineering Test 2 includes specifications, connections, tension and compression members, beams, plate girders, and plastic analysis.'),
('transportation','Civil Engineering Test 2 includes highway alignment, geometric design, materials, flexible and rigid pavements, traffic studies, signals, intersections, and channelization.'),
('surveying','Civil Engineering Test 2 includes chain, compass, levelling, theodolite, tacheometry, traversing, curves, contours, plane tables, total stations, DGPS, and GIS.'),
('construction technology','Civil Engineering Test 2 includes cement, aggregates, admixtures, concrete testing, masonry, timber, bituminous materials, steel, non-ferrous metals, ceramics, glass, and polymers.'),
('computer science basics','Computer Science-related HD syllabi include algorithms, data structures, programming, computer organization, operating systems, networks, databases, and software engineering.'),
('software C programming','The Software Systems test includes C control constructs, functions, recursion, dynamic memory, pointers, address arithmetic, and linked lists.'),
('software advanced C','The Software Systems test includes user-defined types, stacks, queues, trees, macros, preprocessing, modular compilation, libraries, files, I/O, and strings.'),
('object orientation','The Software Systems test includes objects, classes, delegation, inheritance, dynamic binding, polymorphism, templates, lifecycle, requirements, design patterns, testing, and quality.'),
('database systems','The Software Systems test includes ER modelling, normalization, and SQL database querying.'),
('core systems','The Software Systems test includes Boolean algebra, gates, circuits, instruction sets, arithmetic, memory, operating systems, filesystems, Ethernet, TCP/UDP/IP, HTTP, HTML, XML, and client-server systems.'),
('economics','The Economics syllabus includes microeconomics, macroeconomics, econometrics, money and banking, public finance, growth and development, international economics, and development issues.'),
('mathematics optimization','The Mathematics syllabus includes linear programming, simplex, duality, transportation models, goal programming, integer programming, and nonlinear algorithms.'),
('mathematics discrete','The Mathematics syllabus includes logic, proof, combinatorics, recurrence relations, relations, digraphs, orderings, Boolean algebra, and Boolean functions.'),
('mathematics analysis','The Mathematics syllabus includes real analysis, measure and integration, topology, functional analysis, differential geometry, ordinary and partial differential equations, and numerical analysis.'),
('physics modern','The Physics syllabus includes relativity, wave-particle properties, uncertainty, Bohr and Schrödinger models, nuclear transformations, and one-dimensional potentials.'),
('physics electromagnetism','The Physics syllabus includes electrostatics, magnetostatics, Faraday’s law, Maxwell equations, conservation laws, electromagnetic waves, potentials, and radiation.'),
('physics quantum','The Physics syllabus includes Schrödinger equations, eigenvalues, operators, harmonic oscillators, angular momentum, hydrogen, spin, identical particles, and perturbation theory.'),
('physics solid state','The Physics syllabus includes diffraction, crystal structure, lattice dynamics, free-electron theory, energy bands, semiconductors, and superconductivity.'),
('environmental engineering','The Environmental special test includes pollution, water and wastewater treatment, water-quality measurement, sludge treatment and disposal, and solid-waste management.'),
('HD question bank','HD tests are generated from a large question bank, so candidates receive different sets of comparable difficulty, content, and question types.'),
('HD centre cancellation','The Institute may cancel an HD test centre and accommodate affected candidates at alternate centres including Pilani, Goa, or Hyderabad.'),
('HD final authority','The Vice-Chancellor’s decision is final in matters of HD test conduct, and HD disputes fall within Pilani jurisdiction.'),
]

def combine_facts(left, right, left_name, right_name, n):
    topic_l, _, _, ans_l, pages_l, _, keys_l = left
    topic_r, _, _, ans_r, pages_r, _, keys_r = right
    return (
        f'{left_name}/{right_name}: {n}',
        f'How does {left_name} address {topic_l} compared with {right_name} on {topic_r}?',
        f'What should an applicant know about {topic_l} in {left_name} and {topic_r} in {right_name}?',
        f'{left_name}: {ans_l} {right_name}: {ans_r}',
        f'{left_name} p. {pages_l}; {right_name} p. {pages_r}',
        'cross-document-comparison',
        f'{keys_l}, {keys_r}'
    )

bitsat += topic_facts('BITSAT syllabus/application', bitsat_topics, '17-36', 'syllabus-and-application', 'BITSAT-2026')
fd += topic_facts('FD fee/policy detail', fd_topics, '25-38', 'fees-and-policy', 'FD-Admission-Modality')
hd += topic_facts('HD syllabus/test detail', hd_topics, '16-53', 'syllabus-and-test-policy', 'BITS-HD-2025-26')
for i in range(90):
    if i < 45:
        cross.append(combine_facts(bitsat[i], hd[i], 'BITSAT-2026', 'BITS-HD-2025-26', i + 1))
    else:
        j = i - 45
        cross.append(combine_facts(bitsat[j], fd[j], 'BITSAT-2026', 'FD-Admission-Modality', i + 1))

bitsat = bitsat[:125]
fd = fd[:125]
hd = hd[:125]
cross = cross[:125]
rows = variants('BITSAT-2026', 'BITSAT-2026_brochure (1).pdf', bitsat)
rows += variants('FD-Admission-Modality', 'Admission_Modality_FD (1).pdf', fd)
rows += variants('BITS-HD-2025-26', 'HD_Brochure_2025_26 (1).pdf', hd)
rows += variants('Cross-document', ['BITSAT-2026_brochure (1).pdf', 'Admission_Modality_FD (1).pdf', 'HD_Brochure_2025_26 (1).pdf'], cross)

print('Base fact counts:', len(bitsat), len(fd), len(hd), len(cross))
assert len(bitsat) == 125 and len(fd) == 125 and len(hd) == 125 and len(cross) == 125
assert len(rows) == 1000
with OUT.open('w', encoding='utf-8') as f:
    for row in rows:
        f.write(json.dumps(row, ensure_ascii=False) + '\n')
print(f'Wrote {len(rows)} FAQ records to {OUT}')
print('Counts:', {s: sum(r['source'] == s for r in rows) for s in ['BITSAT-2026','FD-Admission-Modality','BITS-HD-2025-26','Cross-document']})

# Chatbot-ready enrichment is deliberately kept on factual records, while
# conversational responses are written to a separate intent file below.
def suggestions_for(row):
    category = row['category']
    if 'eligibility' in category:
        return ['Which programmes are available?', 'What documents are required?', 'What is the application deadline?']
    if 'fees' in category or category == 'financial-assistance':
        return ['What admission year does this fee apply to?', 'Are scholarships available?', 'Where can I verify current fees?']
    if 'dates' in category:
        return ['What happens after this deadline?', 'Can the date change?', 'Where are official updates posted?']
    if 'test' in category or 'syllabus' in category:
        return ['What is the test format?', 'Which test centres are available?', 'What is the marking scheme?']
    if 'application' in category or 'documents' in category:
        return ['What fee is required?', 'What are the important dates?', 'Can I edit my application?']
    if 'scholarship' in category or 'financial' in category:
        return ['What are the eligibility conditions?', 'Is the award renewable?', 'What other assistance is listed?']
    return ['What are the eligibility requirements?', 'What are the important dates?', 'Where can I verify this information?']

pair_map = {}
for row in rows:
    pair_map[row['id'][:-2]] = pair_map.get(row['id'][:-2], []) + [row]
for row in rows:
    pair = sorted(pair_map[row['id'][:-2]], key=lambda x: x['id'])
    canonical = pair[0]['question']
    alternatives = [x['question'] for x in pair if x['question'] != row['question']]
    row['intent_type'] = 'factual_faq'
    row['canonical_question'] = canonical
    row['alternative_questions'] = alternatives
    row['follow_up_suggestions'] = suggestions_for(row)
    row['context_keys'] = ['admission_year', 'source', 'category', 'keywords']
    row['answer_mode'] = 'predefined_only'
    row['source_references'] = [
        {'file': filename, 'pages': row['source_pages'][0], 'admission_year': row['admission_year']}
        for filename in row['source_files']
    ]
    row['display_source'] = '; '.join(
        f"{ref['file']} (page(s) {ref['pages']}, {ref['admission_year']})"
        for ref in row['source_references']
    )

with OUT.open('w', encoding='utf-8') as f:
    for row in rows:
        f.write(json.dumps(row, ensure_ascii=False) + '\n')

conversation_intents = [
    {'id': 'CONV-001', 'intent_type': 'conversational', 'intent': 'greeting', 'trigger_phrases': ['hi', 'hello', 'hey', 'good morning', 'good evening', 'namaste'], 'answer': 'Hello! I can answer predefined questions about BITSAT-2026, First-Degree admissions, and Higher-Degree admissions. What would you like to know?', 'category': 'conversation', 'keywords': ['greeting', 'hello', 'start'], 'follow_up_suggestions': ['Show categories', 'What can you help with?', 'Ask about eligibility'], 'context_action': 'reset_pending_topic_keep_admission_year', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-002', 'intent_type': 'conversational', 'intent': 'farewell', 'trigger_phrases': ['bye', 'goodbye', 'see you', 'thanks bye', 'that is all'], 'answer': 'Goodbye! If you need more admission information, please return and ask another question.', 'category': 'conversation', 'keywords': ['farewell', 'bye', 'end'], 'follow_up_suggestions': [], 'context_action': 'clear_active_topic', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-003', 'intent_type': 'conversational', 'intent': 'thanks', 'trigger_phrases': ['thanks', 'thank you', 'that helped', 'great thanks'], 'answer': 'You’re welcome. You can ask about eligibility, programmes, fees, dates, tests, scholarships, documents, or admission procedures.', 'category': 'conversation', 'keywords': ['thanks', 'appreciation'], 'follow_up_suggestions': ['Show categories', 'Ask about deadlines', 'Ask about fees'], 'context_action': 'keep_context', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-004', 'intent_type': 'conversational', 'intent': 'help', 'trigger_phrases': ['help', 'what can you do', 'how do I use this', 'what can I ask'], 'answer': 'Ask a natural-language question about BITSAT-2026, First-Degree admissions, or Higher-Degree admissions. I return predefined answers with source files and page references, and I will say when the PDFs do not support an answer.', 'category': 'conversation', 'keywords': ['help', 'capabilities', 'usage'], 'follow_up_suggestions': ['Show categories', 'Ask about BITSAT eligibility', 'Ask about Higher-Degree fees'], 'context_action': 'keep_context', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-005', 'intent_type': 'conversational', 'intent': 'category_navigation', 'trigger_phrases': ['show categories', 'menu', 'topics', 'what categories are available', 'browse topics'], 'answer': 'Available categories are: eligibility; programmes; application; fees; deadlines; test format; test centres; merit and waitlist; scholarships and financial assistance; documents; conduct; contacts; syllabus; and cross-document comparisons.', 'category': 'navigation', 'keywords': ['categories', 'menu', 'topics'], 'follow_up_suggestions': ['Eligibility', 'Fees', 'Deadlines', 'Test format', 'Scholarships', 'Contacts'], 'context_action': 'set_navigation_mode', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-006', 'intent_type': 'conversational', 'intent': 'category_selection', 'trigger_phrases': ['eligibility', 'fees', 'deadlines', 'programmes', 'scholarships', 'test format', 'test centres', 'documents', 'contacts', 'syllabus'], 'answer': 'I’ll use that category to search the predefined admission FAQs. Please include the programme or admission year if your question could apply to more than one brochure.', 'category': 'navigation', 'keywords': ['category selection', 'routing'], 'follow_up_suggestions': ['Ask a specific question', 'Specify BITSAT-2026', 'Specify Higher-Degree 2025-26'], 'context_action': 'set_active_category', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-007', 'intent_type': 'conversational', 'intent': 'follow_up_request', 'trigger_phrases': ['tell me more', 'explain more', 'what about that', 'continue', 'more details'], 'answer': 'I’ll continue using the current admission year, category, and source context when available. If the context is ambiguous, I’ll ask you to specify the programme or admission year rather than guess.', 'category': 'conversation', 'keywords': ['follow-up', 'context', 'more'], 'follow_up_suggestions': ['Ask for the source', 'Ask for related deadlines', 'Ask for related fees'], 'context_action': 'reuse_last_result_context', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-008', 'intent_type': 'conversational', 'intent': 'source_request', 'trigger_phrases': ['where did this come from', 'source', 'cite this', 'which page', 'show reference'], 'answer': 'Every factual result includes its source filename, page reference, and admission year. The chatbot should display those fields with the predefined answer.', 'category': 'conversation', 'keywords': ['source', 'citation', 'page'], 'follow_up_suggestions': ['Ask another question', 'Ask about a different admission year'], 'context_action': 'keep_context', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-009', 'intent_type': 'conversational', 'intent': 'unknown_question', 'trigger_phrases': ['fallback', 'unknown', 'not understood'], 'answer': 'I could not find a verified answer in the supplied BITS admission PDFs. I will not guess. Please rephrase the question, specify BITSAT-2026, First-Degree 2022-23, or Higher-Degree 2025-26, or check the official BITS admissions website.', 'category': 'conversation', 'keywords': ['unknown', 'unsupported', 'fallback'], 'follow_up_suggestions': ['Rephrase the question', 'Specify the admission year', 'Show categories'], 'context_action': 'preserve_context_and_request_clarification', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
    {'id': 'CONV-010', 'intent_type': 'conversational', 'intent': 'currentness_warning', 'trigger_phrases': ['is this current', 'latest fee', 'latest date', 'does this still apply'], 'answer': 'The answer will identify its admission year. Dates and fees from the PDFs may be historical or tentative, so verify current information on the official BITS admissions website before acting.', 'category': 'conversation', 'keywords': ['current', 'latest', 'verify'], 'follow_up_suggestions': ['Ask for the source year', 'Ask for the official website', 'Ask another question'], 'context_action': 'preserve_context_and_mark_verification_needed', 'source_files': [], 'source_pages': [], 'admission_year': 'not_applicable'},
]
with (DATA_DIR / 'chatbot_intents.jsonl').open('w', encoding='utf-8') as f:
    for row in conversation_intents:
        f.write(json.dumps(row, ensure_ascii=False) + '\n')

config = {
    'version': '1.0',
    'factual_dataset': 'faq_dataset.jsonl',
    'conversation_dataset': 'chatbot_intents.jsonl',
    'routing_order': ['greeting', 'farewell', 'thanks', 'help', 'category_navigation', 'category_selection', 'follow_up_request', 'source_request', 'currentness_warning', 'factual_faq', 'unknown_question'],
    'response_policy': {'factual_answers': 'Return answer verbatim from the matched record and display display_source.', 'unknown_questions': 'Never synthesize admission facts; use the unknown_question response.', 'time_sensitive_facts': 'Preserve admission_year and advise official-site verification for dates, fees, deadlines, and tentative schedules.'},
    'context_fields': ['active_intent', 'active_category', 'admission_year', 'source', 'keywords', 'last_faq_id'],
    'instant_response_design': {'lookup_keys': ['normalized_question', 'alternative_questions', 'keywords', 'category', 'admission_year'], 'no_network_required_for_answer': True, 'ranking': 'exact question, alternative phrasing, category plus keyword overlap, then unknown'},
    'display_fields': ['answer', 'display_source', 'follow_up_suggestions'],
    'separation_rule': 'Only records with intent_type factual_faq may answer admission-fact questions; conversational records must not be used as factual sources.'
}
(DATA_DIR / 'chatbot_config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Wrote faq_dataset.jsonl, chatbot_intents.jsonl, and chatbot_config.json to {DATA_DIR}')
