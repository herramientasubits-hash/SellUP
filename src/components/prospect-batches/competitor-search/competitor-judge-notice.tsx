import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  describeCompetitorJudgeNotice,
  readCompetitorJudgeNotice,
} from '@/modules/prospect-batches/competitor-search/competitor-batch-notices';

/**
 * «Competidores de una empresa» — aviso cuando el juez de Claude no revisó todo lo
 * gratuito (no respondió o la lista pasó su tope). Sin aviso, nada se pinta.
 */
export function CompetitorJudgeNotice({ batchMetadata }: { batchMetadata: unknown }) {
  const notice = readCompetitorJudgeNotice(batchMetadata);
  if (!notice) return null;
  return (
    <Alert variant="warning" role="status">
      <AlertDescription className="line-clamp-2 text-xs" title={describeCompetitorJudgeNotice(notice)}>
        {describeCompetitorJudgeNotice(notice)}
      </AlertDescription>
    </Alert>
  );
}
